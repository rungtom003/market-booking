import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import { DeliveryError, retryableStatus } from '../delivery-error';
import type { SmsMessage, SmsProvider } from './sms.provider';

export const THAIBULKSMS_URL = 'https://api-v2.thaibulksms.com/sms';

/** error ของ ThaiBulkSMS: `{ error: { code, name, description } }` */
interface ThaiBulkSmsError {
  error?: { code?: number; name?: string; description?: string };
}

interface ThaiBulkSmsResult {
  phone_number_list?: { number: string; message_id: string }[];
  bad_phone_number_list?: { number: string; message: string }[];
}

/**
 * ThaiBulkSMS API v2 — POST /sms (form-urlencoded, HTTP Basic = API key : API secret)
 * https://developer.thaibulksms.com — ตอบ 201 เมื่อรับข้อความ; เบอร์ที่ใช้ไม่ได้อยู่ใน `bad_phone_number_list`
 */
@Injectable()
export class ThaiBulkSmsProvider implements SmsProvider {
  private readonly logger = new Logger(ThaiBulkSmsProvider.name);

  constructor(private readonly config: AppConfigService) {}

  async send(message: SmsMessage): Promise<void> {
    const key = this.config.get('SMS_API_KEY');
    const secret = this.config.get('SMS_API_SECRET');
    const sender = this.config.get('SMS_SENDER');
    if (!key || !secret || !sender) {
      throw new DeliveryError('ThaiBulkSMS is not configured', false);
    }

    const body = new URLSearchParams({ msisdn: message.to, message: message.text, sender });
    const creditType = this.config.get('SMS_CREDIT_TYPE');
    if (creditType) body.set('force', creditType);

    let res: Response;
    try {
      res = await fetch(THAIBULKSMS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      // timeout/เครือข่าย — ไม่รู้ว่าส่งไปแล้วหรือยัง แต่ข้อความหายดีกว่าไม่ส่ง → ลองใหม่
      this.logger.warn(`ThaiBulkSMS request failed: ${String(error)}`);
      throw new DeliveryError('SMS provider is not reachable', true);
    }

    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as ThaiBulkSmsError;
      const name = detail.error?.name ?? 'UNKNOWN';
      // 423 = เครดิตหมด (เติมแล้วส่งต่อได้), 429/5xx = ชั่วคราว
      const retryable = res.status === 423 || retryableStatus(res.status);
      this.logger.error(`ThaiBulkSMS HTTP ${res.status} ${name} (${detail.error?.code ?? '-'})`);
      throw new DeliveryError(`SMS provider rejected the message: ${name}`, retryable);
    }

    const result = (await res.json().catch(() => ({}))) as ThaiBulkSmsResult;
    if (!result.phone_number_list?.length) {
      throw new DeliveryError('SMS provider rejected the phone number', false);
    }
  }
}
