import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { AppConfigService } from '../../../config/app-config.service';
import { REDIS } from '../../../redis/redis.module';
import { DeliveryError } from '../delivery-error';
import type { SmsMessage, SmsProvider } from './sms.provider';

/**
 * E2E test อ่านข้อความของเบอร์จาก list นี้ (ใหม่สุดก่อน, dev/test เท่านั้น) — เป็น list เพราะ SMS แจ้งเตือน
 * (queue `notification`) อาจมาถึงหลัง OTP ได้
 */
export const MOCK_SMS_OUTBOX_PREFIX = 'mock-sms:outbox:';
const OUTBOX_TTL_SECONDS = 300;
const OUTBOX_MAX = 20;

/**
 * ไม่ส่ง SMS จริง — dev แสดงข้อความ (รวม OTP) ใน log ให้นักพัฒนาเอาไปกรอก,
 * integration test อ่านจาก `sent`, E2E test อ่านจาก Redis (`mock-sms:outbox:<เบอร์>`)
 * production: ไม่ log ไม่เก็บ และโยน SERVICE_UNAVAILABLE (ต้องตั้ง SMS_PROVIDER จริงก่อนเปิด OTP)
 */
@Injectable()
export class MockSmsProvider implements SmsProvider {
  private readonly logger = new Logger(MockSmsProvider.name);
  /** ข้อความที่ "ส่ง" แล้ว — สำหรับ integration test */
  readonly sent: SmsMessage[] = [];

  constructor(
    private readonly config: AppConfigService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async send(message: SmsMessage): Promise<void> {
    if (this.config.isProduction) {
      throw new DeliveryError('SMS provider is not configured', false);
    }
    this.sent.push(message);
    const key = `${MOCK_SMS_OUTBOX_PREFIX}${message.to}`;
    await this.redis
      .multi()
      .lpush(key, message.text)
      .ltrim(key, 0, OUTBOX_MAX - 1)
      .expire(key, OUTBOX_TTL_SECONDS)
      .exec();
    if (this.config.get('NODE_ENV') === 'development') {
      // ข้อยกเว้นเดียวของกฎ "ห้าม log OTP" — dev เท่านั้น (Phase 1.4 task)
      this.logger.warn(`[mock SMS → ${message.to}] ${message.text}`);
    }
  }

  lastTo(phone: string): SmsMessage | undefined {
    return this.sent.filter((m) => m.to === phone).at(-1);
  }
}
