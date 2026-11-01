import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis, { type RedisOptions } from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { NoShowService } from './noshow.service';

export const NOSHOW_QUEUE = 'noshow';
export const NOSHOW_SCHEDULER_ID = 'noshow-sweep';
/** ตรวจทุก 5 นาที — นับช้ากว่าเวลาปิด check-in ไม่เกินนี้ */
export const NOSHOW_INTERVAL_MS = 5 * 60_000;

/** Queue `noshow`: job ตามเวลา (BullMQ job scheduler — หลาย instance ก็รันครั้งเดียว) เรียก `NoShowService.sweep` */
@Injectable()
export class NoShowProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NoShowProcessor.name);
  private queue?: Queue;
  private worker?: Worker;
  private readonly connections: Redis[] = [];

  constructor(
    private readonly config: AppConfigService,
    private readonly noshow: NoShowService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('WORKERS_ENABLED')) await this.start();
  }

  async start(): Promise<void> {
    if (this.worker) return;
    this.worker = new Worker(NOSHOW_QUEUE, async () => `counted ${await this.noshow.sweep()}`, {
      connection: this.connect({ maxRetriesPerRequest: null }),
    });
    this.worker.on('failed', (job, error) =>
      this.logger.error(`Job ${job?.name}:${job?.id} failed: ${error.message}`, error.stack),
    );
    this.queue = new Queue(NOSHOW_QUEUE, { connection: this.connect({ maxRetriesPerRequest: 2 }) });
    await this.queue.upsertJobScheduler(
      NOSHOW_SCHEDULER_ID,
      { every: NOSHOW_INTERVAL_MS },
      { name: 'sweep', opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
    this.logger.log('No-show worker started');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await Promise.all(this.connections.map((c) => c.quit().catch(() => c.disconnect())));
  }

  private connect(options: RedisOptions): Redis {
    const connection = new Redis(this.config.get('REDIS_URL'), options);
    this.connections.push(connection);
    return connection;
  }
}
