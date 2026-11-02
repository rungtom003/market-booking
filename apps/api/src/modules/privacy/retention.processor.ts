import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis, { type RedisOptions } from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { RetentionService } from './retention.service';

export const RETENTION_QUEUE = 'retention';
export const RETENTION_SCHEDULER_ID = 'retention-daily';
/** 20:00 UTC = 03:00 เวลาไทย (ช่วงคนใช้น้อย — เวลาเดียวกับ backup) */
export const RETENTION_CRON = '0 20 * * *';

/** Queue `retention`: วันละครั้ง (BullMQ job scheduler แบบ cron — หลาย instance ก็รันครั้งเดียว) */
@Injectable()
export class RetentionProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RetentionProcessor.name);
  private queue?: Queue;
  private worker?: Worker;
  private readonly connections: Redis[] = [];

  constructor(
    private readonly config: AppConfigService,
    private readonly retention: RetentionService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('WORKERS_ENABLED')) await this.start();
  }

  async start(): Promise<void> {
    if (this.worker) return;
    this.worker = new Worker(
      RETENTION_QUEUE,
      async () => JSON.stringify(await this.retention.sweep()),
      { connection: this.connect({ maxRetriesPerRequest: null }) },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(`Job ${job?.name}:${job?.id} failed: ${error.message}`, error.stack),
    );
    this.queue = new Queue(RETENTION_QUEUE, {
      connection: this.connect({ maxRetriesPerRequest: 2 }),
    });
    await this.queue.upsertJobScheduler(
      RETENTION_SCHEDULER_ID,
      { pattern: RETENTION_CRON },
      { name: 'sweep', opts: { removeOnComplete: 30, removeOnFail: 30 } },
    );
    this.logger.log('Retention worker started');
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
