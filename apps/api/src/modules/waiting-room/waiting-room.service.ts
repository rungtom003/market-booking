import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ErrorCode,
  RoundStatus,
  type WaitingRoomStats,
  WaitingRoomState,
  type WaitingRoomStatus,
} from '@market-booking/shared';
import type Redis from 'ioredis';
import { EventChannel } from '../../common/event-channel';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS } from '../../redis/redis.module';
import type { AdminPrincipal, VendorPrincipal } from '../auth/principal';
import { MarketService } from '../market/market.service';
import { SettingsService } from '../settings/settings.service';

/** หน้าเว็บถามสถานะทุก 5 วินาที — ไม่ถามเกินนี้ = ปิดหน้าไปแล้ว ไม่ปล่อยเข้า (ไม่เปลืองที่) */
export const WAITING_STALE_MS = 45_000;
/** คนที่เข้าคิวก่อนรอบเปิดได้ลำดับสุ่มในช่วงนี้ก่อนเวลาเปิด — มาก่อนเปิดได้ก่อนคนที่มาหลังเปิดเสมอ */
const PRE_OPEN_SPREAD_MS = 60_000;
/** เก็บ key ต่อหลังปิดรอบ (debug) แล้วลบเอง */
const KEY_TTL_AFTER_CLOSE_S = 24 * 3600;

const keys = {
  /** zset ลำดับคิว: member = vendorId, score = ลำดับ (ms) */
  queue: (roundId: string) => `wr:${roundId}:q`,
  /** zset ผู้ที่อยู่ในหน้าจอง: score = เวลาหมดสิทธิ์ (ms) */
  admitted: (roundId: string) => `wr:${roundId}:in`,
  /** zset เวลาที่ถามสถานะล่าสุด (ms) */
  seen: (roundId: string) => `wr:${roundId}:seen`,
};

interface RoundRow {
  id: string;
  marketId: string;
  openAt: Date;
  closeAt: Date;
  waitingRoomCapacity: number | null;
}

const ROUND_FIELDS = {
  id: true,
  marketId: true,
  openAt: true,
  closeAt: true,
  waitingRoomCapacity: true,
} as const;

export interface WaitingRoomAdmittedEvent {
  roundId: string;
  vendorId: string;
  admittedUntil: Date;
}

/**
 * Waiting Room (Phase 11.1) — คิวใน Redis ต่อรอบ: เข้าคิว → worker ปล่อยเข้าหน้าจองเท่าที่ว่าง
 * (`waiting_room_capacity` คนพร้อมกัน, คนละ `waiting_room_session_minutes`) → จอง (HOLD) ได้เฉพาะคนที่อยู่ในหน้าจอง
 * worker ทำงานที่เดียว (BullMQ job scheduler) จึงไม่ต้องล็อคระหว่าง instance; ZPOPMIN เป็น atomic
 */
@Injectable()
export class WaitingRoomService {
  private readonly logger = new Logger(WaitingRoomService.name);
  private readonly admittedChannel = new EventChannel<WaitingRoomAdmittedEvent>(
    'waiting_room.admitted',
    this.logger,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly markets: MarketService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onAdmitted(listener: (event: WaitingRoomAdmittedEvent) => void): () => void {
    return this.admittedChannel.on(listener);
  }

  /** เข้าคิว (ซ้ำได้ — อยู่ในคิว/หน้าจองแล้วไม่เปลี่ยนลำดับ) */
  async join(vendor: VendorPrincipal, roundId: string, now = new Date()) {
    const round = await this.findRound(vendor.marketId, roundId);
    if (round.waitingRoomCapacity !== null && now < round.closeAt) {
      const admittedUntil = await this.redis.zscore(keys.admitted(round.id), vendor.id);
      if (!admittedUntil || Number(admittedUntil) <= now.getTime()) {
        const score =
          now < round.openAt
            ? round.openAt.getTime() - PRE_OPEN_SPREAD_MS + Math.random() * PRE_OPEN_SPREAD_MS
            : now.getTime();
        await this.redis
          .multi()
          .zadd(keys.queue(round.id), 'NX', score, vendor.id)
          .zadd(keys.seen(round.id), now.getTime(), vendor.id)
          .exec();
        await this.expireKeys(round);
      }
    }
    return this.statusOf(round, vendor.id, now);
  }

  /** สถานะ — ถามบ่อยได้ (นับเป็น "ยังอยู่" ถ้าอยู่ในคิว) */
  async status(vendor: VendorPrincipal, roundId: string, now = new Date()) {
    const round = await this.findRound(vendor.marketId, roundId);
    return this.statusOf(round, vendor.id, now);
  }

  /** ออกจากคิว/หน้าจอง — คืนที่ให้คนถัดไป */
  async leave(vendor: VendorPrincipal, roundId: string): Promise<void> {
    const round = await this.findRound(vendor.marketId, roundId);
    await this.redis
      .multi()
      .zrem(keys.queue(round.id), vendor.id)
      .zrem(keys.admitted(round.id), vendor.id)
      .zrem(keys.seen(round.id), vendor.id)
      .exec();
  }

  /** ใช้ตอนจอง (HOLD): รอบที่เปิด Waiting Room ต้องอยู่ในหน้าจองและยังไม่หมดเวลา */
  async assertAdmitted(
    round: { id: string; waitingRoomCapacity: number | null },
    vendorId: string,
    now = new Date(),
  ): Promise<void> {
    if (round.waitingRoomCapacity === null) return;
    const until = await this.redis.zscore(keys.admitted(round.id), vendorId);
    if (!until || Number(until) <= now.getTime()) {
      throw new AppException(ErrorCode.WAITING_ROOM_REQUIRED, 'Waiting room admission required', {
        roundId: round.id,
      });
    }
  }

  async stats(admin: AdminPrincipal, roundId: string, now = new Date()): Promise<WaitingRoomStats> {
    const round = await this.findRound(await this.markets.resolveForAdmin(admin), roundId, false);
    const [waiting, admitted] = await Promise.all([
      this.redis.zcard(keys.queue(round.id)),
      this.redis.zcount(keys.admitted(round.id), `(${now.getTime()}`, '+inf'),
    ]);
    return {
      enabled: round.waitingRoomCapacity !== null,
      capacity: round.waitingRoomCapacity,
      waiting,
      admitted,
    };
  }

  /** worker: ทุกรอบที่เปิดจองอยู่และใช้ Waiting Room — คืนจำนวนที่ปล่อยเข้า */
  async admitAll(now = new Date()): Promise<number> {
    const rounds = await this.prisma.bookingRound.findMany({
      where: {
        status: RoundStatus.PUBLISHED,
        waitingRoomCapacity: { not: null },
        openAt: { lte: now },
        closeAt: { gt: now },
      },
      select: ROUND_FIELDS,
    });
    let total = 0;
    for (const round of rounds) total += await this.admit(round, now);
    return total;
  }

  /** ปล่อยคนจากหัวคิวเท่าที่ว่าง — คนที่ไม่ได้ถามสถานะนาน (ปิดหน้าไปแล้ว) ถูกตัดออก */
  async admit(round: RoundRow, now = new Date()): Promise<number> {
    const capacity = round.waitingRoomCapacity;
    if (capacity === null) return 0;
    const t = now.getTime();
    await this.redis.zremrangebyscore(keys.admitted(round.id), '-inf', t);
    let free = capacity - (await this.redis.zcard(keys.admitted(round.id)));
    if (free <= 0) return 0;

    const sessionMs =
      (await this.settings.get(round.marketId, 'waiting_room_session_minutes')) * 60_000;
    const admitted: string[] = [];
    while (free > 0) {
      const popped = await this.redis.zpopmin(keys.queue(round.id), free);
      if (popped.length === 0) break;
      for (let i = 0; i < popped.length; i += 2) {
        const vendorId = popped[i]!;
        const seen = await this.redis.zscore(keys.seen(round.id), vendorId);
        if (seen && t - Number(seen) <= WAITING_STALE_MS) {
          await this.redis.zadd(keys.admitted(round.id), t + sessionMs, vendorId);
          admitted.push(vendorId);
          free--;
        } else {
          await this.redis.zrem(keys.seen(round.id), vendorId);
        }
      }
    }
    if (admitted.length > 0) {
      await this.expireKeys(round);
      this.admittedChannel.emit(
        admitted.map((vendorId) => ({
          roundId: round.id,
          vendorId,
          admittedUntil: new Date(t + sessionMs),
        })),
      );
    }
    return admitted.length;
  }

  private async statusOf(round: RoundRow, vendorId: string, now: Date): Promise<WaitingRoomStatus> {
    const base = {
      roundId: round.id,
      opensAt: round.openAt.toISOString(),
      serverTime: now.toISOString(),
    };
    if (round.waitingRoomCapacity === null) {
      return {
        ...base,
        state: WaitingRoomState.NOT_REQUIRED,
        position: null,
        waiting: 0,
        admittedUntil: null,
      };
    }
    const [until, rank, waiting] = await Promise.all([
      this.redis.zscore(keys.admitted(round.id), vendorId),
      this.redis.zrank(keys.queue(round.id), vendorId),
      this.redis.zcard(keys.queue(round.id)),
    ]);
    if (until && Number(until) > now.getTime()) {
      return {
        ...base,
        state: WaitingRoomState.ADMITTED,
        position: null,
        waiting,
        admittedUntil: new Date(Number(until)).toISOString(),
      };
    }
    if (rank !== null) {
      await this.redis.zadd(keys.seen(round.id), now.getTime(), vendorId);
      return {
        ...base,
        state: WaitingRoomState.WAITING,
        position: rank + 1,
        waiting,
        admittedUntil: null,
      };
    }
    return {
      ...base,
      state: WaitingRoomState.NOT_JOINED,
      position: null,
      waiting,
      admittedUntil: null,
    };
  }

  /** รอบที่ผู้ค้าเห็น (PUBLISHED) — admin เห็นทุกสถานะ */
  private async findRound(marketId: string, roundId: string, publishedOnly = true) {
    const round = await this.prisma.bookingRound.findFirst({
      where: {
        id: roundId,
        marketId,
        ...(publishedOnly && { status: RoundStatus.PUBLISHED }),
      },
      select: ROUND_FIELDS,
    });
    if (!round) throw new AppException(ErrorCode.NOT_FOUND, 'Round not found');
    return round;
  }

  private async expireKeys(round: RoundRow): Promise<void> {
    const at = Math.ceil(round.closeAt.getTime() / 1000) + KEY_TTL_AFTER_CLOSE_S;
    await this.redis
      .multi()
      .expireat(keys.queue(round.id), at)
      .expireat(keys.admitted(round.id), at)
      .expireat(keys.seen(round.id), at)
      .exec();
  }
}
