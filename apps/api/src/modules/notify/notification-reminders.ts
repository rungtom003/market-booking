import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS } from '../../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import { LineMessagingProvider } from './line/line-messaging.provider';
import { NotificationService } from './notification.service';
import { NotificationQueue, TICK_JOB } from './notification.queue';

/** ค่าสูงสุดของ setting (7 วัน / 1 วัน) — ดึงเฉพาะที่อาจถึงเวลาแจ้ง */
const ROUND_LOOKAHEAD_MS = 7 * 24 * 60 * 60_000;
const PAYMENT_LOOKAHEAD_MS = 24 * 60 * 60_000;
const VENDOR_BATCH = 500;

const minutes = (n: number) => n * 60_000;

/**
 * งานตามเวลา (job `tick` ทุก 1 นาที, รันครั้งเดียวแม้มีหลาย instance):
 * - แจ้งผู้ค้าที่อนุมัติแล้วก่อนรอบเปิด `notify_before_round_open_minutes`
 * - เตือนผู้ค้าที่ยังไม่ชำระก่อนหมดเวลา `notify_before_payment_due_minutes`
 * - ข้อความที่ค้างไม่มี job → ใส่ใหม่
 * ส่งซ้ำไม่ได้เพราะ dedupeKey (รวมเวลาเปิด/กำหนดชำระ — เลื่อนเวลาแล้วแจ้งใหม่ตามเวลาใหม่)
 */
@Injectable()
export class NotificationReminders implements OnModuleInit {
  private readonly logger = new Logger(NotificationReminders.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
    private readonly queue: NotificationQueue,
    private readonly line: LineMessagingProvider,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    this.queue.handle(TICK_JOB, () => this.tick());
  }

  async tick(now: Date = new Date()): Promise<string> {
    // แต่ละงานแยกกัน — งานหนึ่งพังไม่ทำให้อีกงานไม่ได้ทำ
    const run = async (name: string, task: () => Promise<number>) => {
      try {
        return await task();
      } catch (error) {
        this.logger.error(`${name} failed: ${String(error)}`);
        return -1;
      }
    };
    const rounds = await run('round reminders', () => this.remindRoundOpening(now));
    const payments = await run('payment reminders', () => this.remindPaymentDue(now));
    const announcements = await run('announcements', () => this.broadcastAnnouncements(now));
    const recovered = await run('recover', () => this.notifications.recoverStale(now));
    return `rounds ${rounds}, payments ${payments}, announcements ${announcements}, recovered ${recovered}`;
  }

  /** คืนจำนวนข้อความใหม่ */
  async remindRoundOpening(now: Date = new Date()): Promise<number> {
    const rounds = await this.prisma.bookingRound.findMany({
      where: {
        status: 'PUBLISHED',
        openAt: { gt: now, lte: new Date(now.getTime() + ROUND_LOOKAHEAD_MS) },
      },
      select: { id: true, marketId: true, name: true, openAt: true },
    });

    let sent = 0;
    for (const round of rounds) {
      const before = await this.settings.get(round.marketId, 'notify_before_round_open_minutes');
      if (before === 0 || round.openAt.getTime() - minutes(before) > now.getTime()) continue;

      // ส่งครบแล้ว — ไม่ต้องไล่ผู้ค้าทั้งตลาดทุกนาที (ถ้า key หาย dedupeKey ยังกันซ้ำ)
      const done = `notify:round-open:${round.id}:${round.openAt.getTime()}`;
      if (await this.redis.exists(done)) continue;

      const openAt = round.openAt.toISOString();
      let cursor: string | undefined;
      for (;;) {
        const vendors = await this.prisma.vendor.findMany({
          where: { marketId: round.marketId, status: 'APPROVED' },
          select: { id: true, phone: true, lineUserId: true },
          orderBy: { id: 'asc' },
          take: VENDOR_BATCH,
          ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        });
        sent += await this.notifications.toVendors(vendors, (v) => ({
          message: { template: 'round.opening_soon', params: { roundName: round.name, openAt } },
          dedupeKey: `round.opening_soon:${round.id}:${round.openAt.getTime()}:${v.id}`,
        }));
        if (vendors.length < VENDOR_BATCH) break;
        cursor = vendors.at(-1)!.id;
      }
      await this.redis.set(done, '1', 'EX', 8 * 24 * 60 * 60);
    }
    return sent;
  }

  /**
   * ประกาศที่เลือก "ส่ง LINE" และถึงเวลาเผยแพร่แล้ว → ส่งถึงผู้ค้าที่อนุมัติแล้วและเชื่อม LINE ครั้งเดียว
   * ยังไม่ตั้ง LINE OA = รอไว้ก่อน (ตั้งค่าแล้วส่งตามหลังได้) — คืนจำนวนข้อความใหม่
   */
  async broadcastAnnouncements(now: Date = new Date()): Promise<number> {
    if (!this.line.enabled) return 0;
    const due = await this.prisma.announcement.findMany({
      where: {
        broadcastLine: true,
        broadcastedAt: null,
        publishAt: { lte: now },
        OR: [{ expireAt: null }, { expireAt: { gt: now } }],
      },
      select: { id: true, marketId: true, title: true, body: true },
    });

    let sent = 0;
    for (const a of due) {
      // จองสิทธิ์ส่งก่อน (หลาย instance/tick ซ้อน ส่งได้ครั้งเดียว) — ถ้าพังกลางทาง dedupeKey กันซ้ำตอนส่งใหม่
      const claimed = await this.prisma.announcement.updateMany({
        where: { id: a.id, broadcastedAt: null },
        data: { broadcastedAt: now },
      });
      if (claimed.count === 0) continue;
      let cursor: string | undefined;
      for (;;) {
        const vendors = await this.prisma.vendor.findMany({
          where: { marketId: a.marketId, status: 'APPROVED', lineUserId: { not: null } },
          select: { id: true, phone: true, lineUserId: true },
          orderBy: { id: 'asc' },
          take: VENDOR_BATCH,
          ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        });
        sent += await this.notifications.toVendors(
          vendors,
          (v) => ({
            message: { template: 'announcement', params: { title: a.title, body: a.body } },
            dedupeKey: `announcement:${a.id}:${v.id}`,
          }),
          { lineOnly: true },
        );
        if (vendors.length < VENDOR_BATCH) break;
        cursor = vendors.at(-1)!.id;
      }
    }
    return sent;
  }

  async remindPaymentDue(now: Date = new Date()): Promise<number> {
    const bookings = await this.prisma.booking.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        paymentDueAt: { gt: now, lte: new Date(now.getTime() + PAYMENT_LOOKAHEAD_MS) },
      },
      select: {
        id: true,
        marketId: true,
        amount: true,
        paymentDueAt: true,
        stall: { select: { code: true } },
        marketDay: { select: { marketDate: true } },
        vendor: { select: { id: true, phone: true, lineUserId: true } },
      },
    });

    let sent = 0;
    for (const b of bookings) {
      const settings = await this.settings.getAll(b.marketId);
      const before = settings.notify_before_payment_due_minutes;
      // ช่วงชำระสั้นกว่าเวลาเตือน = เตือนทันทีหลังยืนยัน (ไม่มีประโยชน์) → ไม่เตือน
      if (before === 0 || settings.payment_deadline_minutes <= before) continue;
      const dueAt = b.paymentDueAt!;
      if (dueAt.getTime() - minutes(before) > now.getTime()) continue;

      sent += await this.notifications.toVendors([b.vendor], () => ({
        message: {
          template: 'payment.due_soon',
          params: {
            bookingId: b.id,
            stallCode: b.stall.code,
            marketDate: b.marketDay.marketDate.toISOString().slice(0, 10),
            amount: Number(b.amount),
            dueAt: dueAt.toISOString(),
          },
        },
        // กำหนดชำระใหม่ (สลิปไม่ผ่าน) = เตือนใหม่ได้
        dedupeKey: `payment.due_soon:${b.id}:${dueAt.getTime()}`,
      }));
    }
    return sent;
  }
}
