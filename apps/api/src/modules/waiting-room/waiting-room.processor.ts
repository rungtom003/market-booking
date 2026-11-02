import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis, { type RedisOptions } from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { WaitingRoomService } from './waiting-room.service';

export const WAITING_ROOM_QUEUE = 'waiting-room';
export const WAITING_ROOM_SCHEDULER_ID = 'waiting-room-admit';
/** ปล่อยคิวทุก 3 วินาที — คนว่างลง (หมดเวลา/ออก) ได้คนถัดไปภายในเวลานี้ */
export const WAITING_ROOM_INTERVAL_MS = 3_000;

/** Queue `waiting-room`: job ตามเวลา (หลาย instance ก็รันที่เดียว) เรียก `WaitingRoomService.admitAll` */
@Injectable()
export class WaitingRoomProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WaitingRoomProcessor.name);
  private queue?: Queue;
  private worker?: Worker;
  private readonly connections: Redis[] = [];

  constructor(
    private readonly config: AppConfigService,
    private readonly room: WaitingRoomService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('WORKERS_ENABLED')) await this.start();
  }

  async start(): Promise<void> {
    if (this.worker) return;
    this.worker = new Worker(
      WAITING_ROOM_QUEUE,
      async () => `admitted ${await this.room.admitAll()}`,
      { connection: this.connect({ maxRetriesPerRequest: null }) },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(`Job ${job?.name}:${job?.id} failed: ${error.message}`, error.stack),
    );
    this.queue = new Queue(WAITING_ROOM_QUEUE, {
      connection: this.connect({ maxRetriesPerRequest: 2 }),
    });
    await this.queue.upsertJobScheduler(
      WAITING_ROOM_SCHEDULER_ID,
      { every: WAITING_ROOM_INTERVAL_MS },
      { name: 'admit', opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
    this.logger.log('Waiting room worker started');
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
