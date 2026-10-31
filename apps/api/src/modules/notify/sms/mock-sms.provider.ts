import { Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@market-booking/shared';
import { AppException } from '../../../common/exceptions/app.exception';
import { AppConfigService } from '../../../config/app-config.service';
import type { SmsMessage, SmsProvider } from './sms.provider';

/**
 * ไม่ส่ง SMS จริง — dev แสดงข้อความ (รวม OTP) ใน log ให้นักพัฒนาเอาไปกรอก, test อ่านจาก `sent`
 * production: ไม่ log และโยน SERVICE_UNAVAILABLE (ต้องตั้ง SMS_PROVIDER จริงก่อนเปิด OTP)
 */
@Injectable()
export class MockSmsProvider implements SmsProvider {
  private readonly logger = new Logger(MockSmsProvider.name);
  /** ข้อความที่ "ส่ง" แล้ว — สำหรับ test เท่านั้น */
  readonly sent: SmsMessage[] = [];

  constructor(private readonly config: AppConfigService) {}

  async send(message: SmsMessage): Promise<void> {
    if (this.config.isProduction) {
      throw new AppException(ErrorCode.SERVICE_UNAVAILABLE, 'SMS provider is not configured');
    }
    this.sent.push(message);
    if (this.config.get('NODE_ENV') === 'development') {
      // ข้อยกเว้นเดียวของกฎ "ห้าม log OTP" — dev เท่านั้น (Phase 1.4 task)
      this.logger.warn(`[mock SMS → ${message.to}] ${message.text}`);
    }
  }

  lastTo(phone: string): SmsMessage | undefined {
    return this.sent.filter((m) => m.to === phone).at(-1);
  }
}
