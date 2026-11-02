import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';

/** queue ของ BullMQ ทั้งหมด (ชื่อเดียวกับใน processor แต่ละตัว) */
export const MONITORED_QUEUES = [
  'notification',
  'booking-expiry',
  'noshow',
  'waiting-room',
  'retention',
] as const;
const JOB_STATES = ['waiting', 'delayed', 'active', 'failed'] as const;

/**
 * Prometheus metrics (Phase 11.4) — `GET /api/v1/metrics` (Prometheus scrape จากใน docker network)
 * HTTP latency/สถานะ, process ของ Node (default metrics), socket ที่ต่ออยู่, งานค้างใน queue, แจ้งเตือนที่ส่งไม่สำเร็จ
 */
@Injectable()
export class MetricsService implements OnApplicationShutdown {
  readonly registry = new Registry();
  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'เวลาตอบ HTTP ต่อ route (route = รูปแบบ path เช่น /api/v1/bookings/:id/confirm)',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });
  readonly alertsReceived = new Counter({
    name: 'market_alert_webhooks_total',
    help: 'จำนวน alert ที่ Alertmanager ส่งมาให้ส่งต่อ LINE',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });
  private socketCount: () => number = () => 0;
  private queues?: Map<string, Queue>;
  private connection?: Redis;

  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {
    collectDefaultMetrics({ register: this.registry });
    // ค่าคำนวณตอน scrape (collect) — อ้าง gauge ผ่านตัวแปรแทน `this` ของ prom-client
    const sockets: Gauge = new Gauge({
      name: 'market_socket_connections',
      help: 'socket (Socket.IO) ที่ต่ออยู่กับ instance นี้',
      registers: [this.registry],
      collect: () => sockets.set(this.socketCount()),
    });
    const jobs: Gauge<'queue' | 'state'> = new Gauge({
      name: 'market_queue_jobs',
      help: 'จำนวนงานใน queue ตามสถานะ',
      labelNames: ['queue', 'state'] as const,
      registers: [this.registry],
      collect: async () => {
        for (const [name, queue] of this.getQueues()) {
          const counts = await queue.getJobCounts(...JOB_STATES).catch(() => null);
          if (!counts) continue;
          for (const state of JOB_STATES) jobs.set({ queue: name, state }, counts[state] ?? 0);
        }
      },
    });
    const failed: Gauge = new Gauge({
      name: 'market_notifications_failed_last_hour',
      help: 'ข้อความแจ้งเตือนที่ส่งไม่สำเร็จ (FAILED) ใน 1 ชั่วโมงล่าสุด',
      registers: [this.registry],
      collect: async () => {
        const count = await this.prisma.notificationLog
          .count({
            where: { status: 'FAILED', updatedAt: { gte: new Date(Date.now() - 3_600_000) } },
          })
          .catch(() => null);
        if (count !== null) failed.set(count);
      },
    });
  }

  /** Realtime gateway บอกวิธีนับ socket (ไม่ import gateway ตรง — กันวน module) */
  setSocketCounter(counter: () => number): void {
    this.socketCount = counter;
  }

  async render(): Promise<{ body: string; contentType: string }> {
    return { body: await this.registry.metrics(), contentType: this.registry.contentType };
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...(this.queues?.values() ?? [])].map((q) => q.close()));
    await this.connection?.quit().catch(() => this.connection?.disconnect());
  }

  /** queue สำหรับอ่านจำนวนงานอย่างเดียว — ต่อ Redis ตอน scrape ครั้งแรก */
  private getQueues(): Map<string, Queue> {
    if (!this.queues) {
      this.connection = new Redis(this.config.get('REDIS_URL'), { maxRetriesPerRequest: 1 });
      this.queues = new Map(
        MONITORED_QUEUES.map((name) => [name, new Queue(name, { connection: this.connection! })]),
      );
    }
    return this.queues;
  }
}
