import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { BookingStatus } from '@market-booking/shared';
import { DelayedError, type Job, Queue, Worker } from 'bullmq';
import Redis, { type RedisOptions } from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { type BookingChangedEvent, BookingEvents } from './booking-events';
import { toEvent } from './booking-mapper';
import { BookingStateService } from './booking-state.service';

export const BOOKING_EXPIRY_QUEUE = 'booking-expiry';
export const SWEEP_SCHEDULER_ID = 'sweep-lapsed-bookings';
/** กวาดการจองที่หมดเวลาแต่ไม่มี job (Redis หาย/restart/job หลุด) */
export const SWEEP_INTERVAL_MS = 60_000;

const EXPIRE_JOB = 'expire';
const SWEEP_JOB = 'sweep';

interface ExpireJobData {
  bookingId: string;
}

/** เวลาหมดอายุของสถานะปัจจุบัน — สถานะอื่นไม่มีกำหนดหมดเวลา */
function deadlineOf(b: {
  status: BookingStatus;
  holdExpiresAt: Date | null;
  paymentDueAt: Date | null;
}): Date | null {
  if (b.status === BookingStatus.HOLD) return b.holdExpiresAt;
  if (b.status === BookingStatus.PENDING_PAYMENT) return b.paymentDueAt;
  return null;
}

/**
 * Queue `booking-expiry` (Overview §5): delayed job ต่อการจอง (jobId = bookingId) ที่เวลาหมด hold/ชำระ
 * ฟัง `booking.changed`: HOLD/PENDING_PAYMENT → ตั้ง job ใหม่ตามเวลาหมด, สถานะอื่น → ลบ job
 * Processor เปลี่ยนเป็น EXPIRED เฉพาะที่หมดเวลาจริง (idempotent) — job มาก่อนเวลา (เช่น ตั้งชนกัน) เลื่อนไปเวลาจริง
 */
@Injectable()
export class BookingExpiryProcessor
  implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(BookingExpiryProcessor.name);
  private queue?: Queue;
  private worker?: Worker;
  private readonly connections: Redis[] = [];
  private unsubscribe?: () => void;

  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly state: BookingStateService,
    private readonly events: BookingEvents,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.onChanged((event) => this.reschedule(event));
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('WORKERS_ENABLED')) await this.start();
  }

  /** เริ่ม worker + ตั้ง job กวาดทุก 1 นาที (BullMQ job scheduler — หลาย instance ก็รันครั้งเดียว) */
  async start(): Promise<void> {
    if (this.worker) return;
    this.worker = new Worker<ExpireJobData>(
      BOOKING_EXPIRY_QUEUE,
      (job, token) => this.process(job, token),
      // worker ต้องรอ Redis ได้ไม่จำกัด (BullMQ บังคับ maxRetriesPerRequest: null)
      { connection: this.connect({ maxRetriesPerRequest: null }) },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(`Job ${job?.name}:${job?.id} failed: ${error.message}`, error.stack),
    );
    await this.getQueue().upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: SWEEP_INTERVAL_MS },
      { name: SWEEP_JOB },
    );
    this.logger.log('Booking expiry worker started');
  }

  async onApplicationShutdown(): Promise<void> {
    this.unsubscribe?.();
    await this.worker?.close();
    await this.queue?.close();
    await Promise.all(this.connections.map((c) => c.quit().catch(() => c.disconnect())));
  }

  /** ตั้ง/ลบ job ตามสถานะล่าสุด — พังได้โดยไม่กระทบการจอง (sweeper เก็บตก) */
  async reschedule(event: BookingChangedEvent): Promise<void> {
    const queue = this.getQueue();
    const existing = await queue.getJob(event.bookingId);
    // job ที่กำลังรันอยู่ (ล็อคไว้) ลบไม่ได้ — ปล่อยให้จบเอง (removeOnComplete)
    await existing?.remove().catch(() => undefined);

    const deadline = deadlineOf(event);
    if (!deadline) return;
    await queue.add(
      EXPIRE_JOB,
      { bookingId: event.bookingId },
      {
        jobId: event.bookingId,
        delay: Math.max(0, deadline.getTime() - Date.now()),
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
  }

  async process(job: Job<ExpireJobData>, token?: string): Promise<string> {
    if (job.name === SWEEP_JOB) return `swept ${await this.sweep()}`;

    const result = await this.expireBooking(job.data.bookingId);
    if (result.retryAt) {
      // ยังไม่ถึงเวลาหมดของสถานะปัจจุบัน → เลื่อน job เดิมไปเวลานั้น
      await job.moveToDelayed(result.retryAt.getTime(), token);
      throw new DelayedError();
    }
    return result.expired ? 'expired' : 'skipped';
  }

  /** หมดเวลาจริง → EXPIRED + event; ยังไม่หมด → บอกเวลาที่ควรลองใหม่; สถานะอื่น → ไม่ทำอะไร */
  async expireBooking(
    bookingId: string,
    now: Date = new Date(),
  ): Promise<{ expired: boolean; retryAt?: Date }> {
    const expired = await this.state.expireLapsed(this.prisma, { id: bookingId }, now);
    if (expired.length > 0) {
      this.events.emitChanged(expired.map(toEvent));
      return { expired: true };
    }
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { status: true, holdExpiresAt: true, paymentDueAt: true },
    });
    const deadline = booking && deadlineOf(booking);
    return deadline && deadline > now ? { expired: false, retryAt: deadline } : { expired: false };
  }

  /** กวาดทุกการจองที่หมดเวลาแต่ยังค้าง (ทุกตลาด) → EXPIRED + event; คืนจำนวนที่เปลี่ยน */
  async sweep(now: Date = new Date()): Promise<number> {
    const expired = await this.state.expireLapsed(this.prisma, {}, now);
    if (expired.length > 0) {
      this.logger.log(`Swept ${expired.length} lapsed booking(s)`);
      this.events.emitChanged(expired.map(toEvent));
    }
    return expired.length;
  }

  /** queue ใช้ทั้งตอนตั้ง job (ทุก process) — สร้างตอนใช้ครั้งแรก app ที่ไม่แตะการจองไม่ต้องต่อ Redis */
  getQueue(): Queue {
    this.queue ??= new Queue(BOOKING_EXPIRY_QUEUE, {
      // ฝั่งใส่ job: Redis ล่มแล้วไม่ค้างนาน
      connection: this.connect({ maxRetriesPerRequest: 2 }),
    });
    return this.queue;
  }

  private connect(options: RedisOptions): Redis {
    const connection = new Redis(this.config.get('REDIS_URL'), options);
    this.connections.push(connection);
    return connection;
  }
}
