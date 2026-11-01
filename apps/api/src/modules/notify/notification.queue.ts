import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { type Job, Queue, Worker } from 'bullmq';
import Redis, { type RedisOptions } from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';

export const NOTIFICATION_QUEUE = 'notification';
/** ส่ง 1 ข้อความ (jobId = notification_logs.id) */
export const SEND_JOB = 'send';
/** ทุก 1 นาที: แจ้งก่อนรอบเปิด/ก่อนหมดเวลาชำระ + ใส่ job ใหม่ให้ข้อความที่ค้าง */
export const TICK_JOB = 'tick';
export const TICK_SCHEDULER_ID = 'notification-tick';
export const TICK_INTERVAL_MS = 60_000;

/** ส่งไม่ผ่านแบบชั่วคราว ลองใหม่ 30 วินาที → 1 → 2 → … → 32 นาที (รวม ~1 ชั่วโมง) แล้วเป็น FAILED */
export const SEND_ATTEMPTS = 8;
export const SEND_BACKOFF_MS = 30_000;

/** สถานะของ job ที่ยังจะถูกรัน — นอกนี้ (completed/failed/ไม่มี) ต้องใส่ใหม่ */
const LIVE_STATES = new Set(['waiting', 'delayed', 'active', 'prioritized', 'waiting-children']);

export interface SendJobData {
  logId: string;
}

type Handler = (job: Job) => Promise<unknown>;

/**
 * Queue `notification` (Overview §5) — แค่โครงสร้าง BullMQ; งานจริงลงทะเบียนผ่าน `handle()`
 * (NotificationService = send, NotificationReminders = tick) จะได้ไม่ต้อง inject วนกัน
 */
@Injectable()
export class NotificationQueue implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationQueue.name);
  private readonly handlers = new Map<string, Handler>();
  private queue?: Queue;
  private worker?: Worker;
  private readonly connections: Redis[] = [];

  constructor(private readonly config: AppConfigService) {}

  handle(name: string, handler: Handler): void {
    this.handlers.set(name, handler);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('WORKERS_ENABLED')) await this.start();
  }

  async start(): Promise<void> {
    if (this.worker) return;
    this.worker = new Worker(
      NOTIFICATION_QUEUE,
      async (job) => {
        const handler = this.handlers.get(job.name);
        if (!handler) throw new Error(`No handler for notification job "${job.name}"`);
        return handler(job);
      },
      {
        connection: this.connect({ maxRetriesPerRequest: null }),
        concurrency: 5,
        // ไม่ยิงผู้ให้บริการถี่เกิน (เช่น แจ้งรอบเปิดถึงผู้ค้าหลายร้อยคนพร้อมกัน)
        limiter: { max: 20, duration: 1_000 },
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.warn(
        `Job ${job?.name}:${job?.id} attempt ${job?.attemptsMade} failed: ${error.message}`,
      ),
    );
    await this.getQueue().upsertJobScheduler(
      TICK_SCHEDULER_ID,
      { every: TICK_INTERVAL_MS },
      { name: TICK_JOB },
    );
    this.logger.log('Notification worker started');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await Promise.all(this.connections.map((c) => c.quit().catch(() => c.disconnect())));
  }

  /** ใส่ job ส่งข้อความ — มี job ที่ยังรออยู่แล้วไม่ใส่ซ้ำ; จบไปแล้ว (failed) ลบแล้วใส่ใหม่ */
  async enqueueSend(logId: string): Promise<void> {
    const queue = this.getQueue();
    const existing = await queue.getJob(logId);
    if (existing) {
      if (LIVE_STATES.has(await existing.getState())) return;
      await existing.remove().catch(() => undefined);
    }
    await queue.add(SEND_JOB, { logId } satisfies SendJobData, {
      jobId: logId,
      attempts: SEND_ATTEMPTS,
      backoff: { type: 'exponential', delay: SEND_BACKOFF_MS },
      removeOnComplete: true,
      removeOnFail: 1000,
    });
  }

  getQueue(): Queue {
    this.queue ??= new Queue(NOTIFICATION_QUEUE, {
      // ฝั่งใส่ job (อยู่ใน request ของผู้ใช้): Redis ล่มแล้วไม่ค้างนาน
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
