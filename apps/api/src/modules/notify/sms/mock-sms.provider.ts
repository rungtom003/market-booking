import { Inject, Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@market-booking/shared';
import type Redis from 'ioredis';
import { AppException } from '../../../common/exceptions/app.exception';
import { AppConfigService } from '../../../config/app-config.service';
import { REDIS } from '../../../redis/redis.module';
import type { SmsMessage, SmsProvider } from './sms.provider';

/** E2E test อ่านข้อความล่าสุดของเบอร์จาก key นี้ (dev/test เท่านั้น) */
export const MOCK_SMS_OUTBOX_PREFIX = 'mock-sms:last:';
const OUTBOX_TTL_SECONDS = 300;

/**
 * ไม่ส่ง SMS จริง — dev แสดงข้อความ (รวม OTP) ใน log ให้นักพัฒนาเอาไปกรอก,
 * integration test อ่านจาก `sent`, E2E test อ่านจาก Redis (`mock-sms:last:<เบอร์>`)
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
      throw new AppException(ErrorCode.SERVICE_UNAVAILABLE, 'SMS provider is not configured');
    }
    this.sent.push(message);
    await this.redis.set(
      `${MOCK_SMS_OUTBOX_PREFIX}${message.to}`,
      message.text,
      'EX',
      OUTBOX_TTL_SECONDS,
    );
    if (this.config.get('NODE_ENV') === 'development') {
      // ข้อยกเว้นเดียวของกฎ "ห้าม log OTP" — dev เท่านั้น (Phase 1.4 task)
      this.logger.warn(`[mock SMS → ${message.to}] ${message.text}`);
    }
  }

  lastTo(phone: string): SmsMessage | undefined {
    return this.sent.filter((m) => m.to === phone).at(-1);
  }
}
