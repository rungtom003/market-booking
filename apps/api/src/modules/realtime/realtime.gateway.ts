import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  ACTIVE_BOOKING_STATUSES,
  BookingStatus,
  ErrorCode,
  MAX_MARKET_DAY_ROOMS_PER_SOCKET,
  SOCKET_NAMESPACE,
  SocketEvent,
  StallDayStatus,
  marketDayRoomSchema,
  socketRoom,
} from '@market-booking/shared';
import type {
  BookingChangedPayload,
  PaymentSubmittedPayload,
  RoundChangedPayload,
  ServerTimePayload,
  SocketAck,
  StallUpdatedPayload,
  VendorRegisteredPayload,
  WaitlistOfferPayload,
} from '@market-booking/shared';
import type { Namespace, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import type { Principal } from '../auth/principal';
import { TokenService } from '../auth/token.service';
import { type BookingChangedEvent, BookingEvents } from '../booking/booking-events';
import { isLapsed } from '../booking/booking-mapper';
import { MarketService } from '../market/market.service';
import {
  NotifyService,
  type PaymentSubmittedEvent,
  type VendorStatusChangedEvent,
  type WaitlistOfferedEvent,
} from '../notify/notify.service';
import { type RoundChangedEvent, RoundEvents } from '../round/round-events';
import { VendorStatusService } from '../vendor/vendor-status.service';

interface SocketData {
  principal: Principal;
  marketId: string;
}
type AppSocket = Socket & { data: SocketData };

const MD_PREFIX = socketRoom.marketDay('');

/**
 * Socket.IO namespace `/booking` (Overview §10) — แจ้งการเปลี่ยนแปลงเท่านั้น สถานะจริงดึงผ่าน REST
 * ห้อง: `vendor:{id}` (ส่วนตัว), `admin:{marketId}`, `market:{marketId}` (round:changed), `md:{marketDayId}` (join เอง)
 */
@WebSocketGateway({ namespace: SOCKET_NAMESPACE })
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly unsubscribe: (() => void)[] = [];

  @WebSocketServer() private readonly server!: Namespace;

  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly markets: MarketService,
    private readonly vendorStatus: VendorStatusService,
    private readonly bookingEvents: BookingEvents,
    private readonly roundEvents: RoundEvents,
    private readonly notify: NotifyService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe.push(
      this.bookingEvents.onChanged((e) => this.onBookingChanged(e)),
      this.roundEvents.onChanged((e) => this.onRoundChanged(e)),
      this.notify.onVendorStatusChanged((e) => this.onVendorStatusChanged(e)),
      this.notify.onPaymentSubmitted((e) => this.onPaymentSubmitted(e)),
      this.notify.onWaitlistOffered((e) => this.onWaitlistOffered(e)),
    );
  }

  onModuleDestroy(): void {
    this.unsubscribe.splice(0).forEach((off) => off());
  }

  /** ตรวจ access token จาก `handshake.auth.token` ก่อนรับการเชื่อมต่อ — ผิด = `connect_error` (message = code) */
  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      this.authenticate(socket as AppSocket).then(
        () => next(),
        (error: unknown) => next(error instanceof Error ? error : new Error(String(error))),
      );
    });
  }

  async handleConnection(socket: AppSocket): Promise<void> {
    const { principal, marketId } = socket.data;
    await socket.join(
      principal.actorType === 'VENDOR'
        ? [socketRoom.vendor(principal.id), socketRoom.market(marketId)]
        : [socketRoom.admin(marketId), socketRoom.market(marketId)],
    );
    socket.emit(SocketEvent.SERVER_TIME, {
      now: new Date().toISOString(),
    } satisfies ServerTimePayload);
  }

  /** ดูผังวันขาย — ต้องเป็นวันขายของตลาดตัวเอง และ join พร้อมกันได้ไม่เกิน 3 วัน */
  @SubscribeMessage(SocketEvent.MD_JOIN)
  async joinMarketDay(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() body: unknown,
  ): Promise<SocketAck> {
    const parsed = marketDayRoomSchema.safeParse(body);
    if (!parsed.success) return { ok: false, code: ErrorCode.VALIDATION_ERROR };
    const room = socketRoom.marketDay(parsed.data.marketDayId);
    if (socket.rooms.has(room)) return { ok: true };

    const joined = [...socket.rooms].filter((r) => r.startsWith(MD_PREFIX)).length;
    if (joined >= MAX_MARKET_DAY_ROOMS_PER_SOCKET) {
      return { ok: false, code: ErrorCode.BAD_REQUEST };
    }
    const exists = await this.prisma.marketDay.count({
      where: { id: parsed.data.marketDayId, marketId: socket.data.marketId },
    });
    if (!exists) return { ok: false, code: ErrorCode.NOT_FOUND };

    await socket.join(room);
    return { ok: true };
  }

  @SubscribeMessage(SocketEvent.MD_LEAVE)
  async leaveMarketDay(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() body: unknown,
  ): Promise<SocketAck> {
    const parsed = marketDayRoomSchema.safeParse(body);
    if (!parsed.success) return { ok: false, code: ErrorCode.VALIDATION_ERROR };
    await socket.leave(socketRoom.marketDay(parsed.data.marketDayId));
    return { ok: true };
  }

  // ───────────── event ภายใน → socket ─────────────

  /**
   * `stall:updated` ไปห้องวันขาย (mine: false) + ห้องเจ้าของการจองปัจจุบัน (mine: true)
   * สถานะอ่านจาก DB ตอนส่ง — event หลายตัวมาถึงสลับลำดับกัน ค่าที่ส่งก็ยังเป็นสถานะล่าสุด
   */
  async onBookingChanged(event: BookingChangedEvent): Promise<void> {
    const { state, ownerId } = await this.stallState(event.marketDayId, event.stallId);
    const base = {
      marketDayId: event.marketDayId,
      stallId: event.stallId,
      state,
      updatedAt: new Date().toISOString(),
    };
    const mdRoom = socketRoom.marketDay(event.marketDayId);
    if (ownerId) {
      const ownerRoom = socketRoom.vendor(ownerId);
      this.server
        .to(mdRoom)
        .except(ownerRoom)
        .emit(SocketEvent.STALL_UPDATED, { ...base, mine: false } satisfies StallUpdatedPayload);
      this.server
        .to(ownerRoom)
        .emit(SocketEvent.STALL_UPDATED, { ...base, mine: true } satisfies StallUpdatedPayload);
    } else {
      this.server
        .to(mdRoom)
        .emit(SocketEvent.STALL_UPDATED, { ...base, mine: false } satisfies StallUpdatedPayload);
    }

    this.server.to(socketRoom.vendor(event.vendorId)).emit(SocketEvent.BOOKING_CHANGED, {
      bookingId: event.bookingId,
      marketDayId: event.marketDayId,
      stallId: event.stallId,
      status: event.status,
      holdExpiresAt: event.holdExpiresAt?.toISOString() ?? null,
      paymentDueAt: event.paymentDueAt?.toISOString() ?? null,
    } satisfies BookingChangedPayload);
  }

  onRoundChanged(event: RoundChangedEvent): void {
    this.server.to(socketRoom.market(event.marketId)).emit(SocketEvent.ROUND_CHANGED, {
      roundId: event.roundId,
      openAt: event.openAt.toISOString(),
      closeAt: event.closeAt.toISOString(),
      status: event.status,
    } satisfies RoundChangedPayload);
  }

  /** ผู้ค้าใหม่/ส่งข้อมูลใหม่รออนุมัติ → badge ฝั่ง admin */
  onVendorStatusChanged(event: VendorStatusChangedEvent): void {
    if (event.to !== 'PENDING') return;
    this.server.to(socketRoom.admin(event.marketId)).emit(SocketEvent.VENDOR_REGISTERED, {
      vendorId: event.vendorId,
    } satisfies VendorRegisteredPayload);
  }

  /** สลิปใหม่รอตรวจ → badge ฝั่ง admin (ข้อมูลจริงโหลดผ่าน REST) */
  onPaymentSubmitted(event: PaymentSubmittedEvent): void {
    this.server.to(socketRoom.admin(event.marketId)).emit(SocketEvent.PAYMENT_SUBMITTED, {
      paymentId: event.paymentId,
      bookingId: event.bookingId,
    } satisfies PaymentSubmittedPayload);
  }

  onWaitlistOffered(event: WaitlistOfferedEvent): void {
    this.server.to(socketRoom.vendor(event.vendorId)).emit(SocketEvent.WAITLIST_OFFER, {
      waitlistId: event.waitlistId,
      bookingId: event.bookingId,
      marketDayId: event.marketDayId,
      stallCode: event.stallCode,
      expiresAt: event.expiresAt.toISOString(),
    } satisfies WaitlistOfferPayload);
  }

  // ───────────── ภายใน ─────────────

  private async authenticate(socket: AppSocket): Promise<void> {
    const token: unknown = socket.handshake.auth?.token;
    const principal = typeof token === 'string' ? this.tokens.verifyAccessToken(token) : null;
    if (!principal) throw new Error(ErrorCode.UNAUTHORIZED);

    if (principal.actorType === 'VENDOR') {
      // เหมือน VendorApprovedGuard: อนุมัติแล้วและไม่ถูกระงับ (ระงับหมดเวลาแล้วปลดให้)
      await this.vendorStatus.liftExpiredSuspension(principal.id);
      const vendor = await this.prisma.vendor.findUnique({
        where: { id: principal.id },
        select: { status: true },
      });
      if (!vendor) throw new Error(ErrorCode.UNAUTHORIZED);
      if (vendor.status === 'SUSPENDED') throw new Error(ErrorCode.VENDOR_SUSPENDED);
      if (vendor.status !== 'APPROVED') throw new Error(ErrorCode.VENDOR_NOT_APPROVED);
      socket.data = { principal, marketId: principal.marketId };
      return;
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { id: principal.id },
      select: { isActive: true },
    });
    if (!admin?.isActive) throw new Error(ErrorCode.UNAUTHORIZED);
    socket.data = { principal, marketId: await this.markets.resolveForAdmin(principal) };
  }

  /** สถานะล็อคในวันขายตอนนี้ (ตรงกับ `GET /market-days/:id/stalls`) + เจ้าของการจองที่ยังมีผล */
  private async stallState(
    marketDayId: string,
    stallId: string,
  ): Promise<{ state: StallDayStatus; ownerId: string | null }> {
    const now = new Date();
    const [bookings, stall, day] = await Promise.all([
      this.prisma.booking.findMany({
        where: { stallId, marketDayId, status: { in: [...ACTIVE_BOOKING_STATUSES] } },
        select: { vendorId: true, status: true, holdExpiresAt: true, paymentDueAt: true },
      }),
      this.prisma.stall.findUnique({
        where: { id: stallId },
        select: {
          isActive: true,
          isReserved: true,
          overrides: { where: { marketDayId }, select: { isClosed: true } },
        },
      }),
      this.prisma.marketDay.findUnique({
        where: { id: marketDayId },
        select: { isCancelled: true },
      }),
    ]);
    const booking = bookings.find((b) => !isLapsed(b, now));
    if (booking) {
      return {
        state: booking.status === BookingStatus.HOLD ? StallDayStatus.HOLD : StallDayStatus.BOOKED,
        ownerId: booking.vendorId,
      };
    }
    const closed =
      !stall?.isActive || stall.isReserved || stall.overrides[0]?.isClosed || day?.isCancelled;
    return { state: closed ? StallDayStatus.CLOSED : StallDayStatus.AVAILABLE, ownerId: null };
  }
}
