import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import { DeliveryError, retryableStatus } from '../delivery-error';
import type { RenderedMessage } from '../templates';

export const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
export const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';

/** ข้อความของ LINE Messaging API (ใช้แค่ text และ flex) */
export type LineMessage =
  | { type: 'text'; text: string }
  | { type: 'flex'; altText: string; contents: Record<string, unknown> };

/** สีหลักเดียวกับหน้าเว็บ (Tailwind green-700) */
const BRAND = '#15803d';

/** การ์ด Flex: หัวข้อ + รายละเอียด + ปุ่มลิงก์ (ถ้ามี) — altText แสดงใน notification/รายการแชท */
export function toFlexMessage(m: RenderedMessage): LineMessage {
  return {
    type: 'flex',
    altText: m.title,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: m.title, weight: 'bold', size: 'md', wrap: true },
          ...m.lines.map((line) => ({
            type: 'text',
            text: line,
            size: 'sm',
            color: '#555555',
            wrap: true,
          })),
        ],
      },
      ...(m.link && {
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: BRAND,
              action: { type: 'uri', label: m.link.label, uri: m.link.url },
            },
          ],
        },
      }),
    },
  };
}

/**
 * LINE Official Account (Messaging API) — push ถึงผู้ค้า (line_user_id จาก LINE Login ภายใต้ provider เดียวกัน)
 * และกลุ่มเจ้าหน้าที่ https://developers.line.biz/en/reference/messaging-api/#send-push-message
 */
@Injectable()
export class LineMessagingProvider {
  private readonly logger = new Logger(LineMessagingProvider.name);

  constructor(private readonly config: AppConfigService) {}

  get enabled(): boolean {
    return Boolean(this.config.get('LINE_MESSAGING_ACCESS_TOKEN'));
  }

  /**
   * `retryKey` (UUID) — LINE รับข้อความเดียวกันครั้งเดียวแม้ส่งซ้ำหลัง timeout (ตอบ 409 = ส่งไปแล้ว)
   * https://developers.line.biz/en/docs/messaging-api/retrying-api-request/
   */
  async push(to: string, messages: LineMessage[], retryKey: string): Promise<void> {
    await this.call(LINE_PUSH_URL, { to, messages }, { 'X-Line-Retry-Key': retryKey });
  }

  /** ตอบกลับ event ของ webhook (ฟรี ไม่นับโควตา) */
  async reply(replyToken: string, messages: LineMessage[]): Promise<void> {
    await this.call(LINE_REPLY_URL, { replyToken, messages });
  }

  private async call(url: string, body: unknown, headers: Record<string, string> = {}) {
    const token = this.config.get('LINE_MESSAGING_ACCESS_TOKEN');
    if (!token) throw new DeliveryError('LINE Messaging API is not configured', false);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      this.logger.warn(`LINE request failed: ${String(error)}`);
      throw new DeliveryError('LINE is not reachable', true);
    }

    // 409 + retry key = ข้อความนี้ถูกรับไปแล้วในครั้งก่อน
    if (res.ok || (res.status === 409 && headers['X-Line-Retry-Key'])) return;

    const detail = (await res.json().catch(() => ({}))) as { message?: string };
    this.logger.error(`LINE HTTP ${res.status}: ${detail.message ?? '-'}`);
    // 400 (ผู้รับ/ข้อความผิด), 401/403 (token/สิทธิ์) ส่งซ้ำไม่ผ่าน; 429 (rate/โควตาเดือน), 5xx ชั่วคราว
    throw new DeliveryError(
      `LINE rejected the message: HTTP ${res.status} ${detail.message ?? ''}`.trim(),
      retryableStatus(res.status),
    );
  }
}
