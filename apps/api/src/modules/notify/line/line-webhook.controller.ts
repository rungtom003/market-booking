import { createHmac, timingSafeEqual } from 'node:crypto';
import { Controller, Headers, HttpCode, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ErrorCode } from '@market-booking/shared';
import type { Request } from 'express';
import { AppException } from '../../../common/exceptions/app.exception';
import { AppConfigService } from '../../../config/app-config.service';
import { Public } from '../../auth/decorators';
import { LineMessagingProvider } from './line-messaging.provider';

/** เฉพาะ field ที่ใช้ — https://developers.line.biz/en/reference/messaging-api/#webhook-event-objects */
interface LineWebhookEvent {
  type: string;
  replyToken?: string;
  source?: { type: string; groupId?: string };
  message?: { type: string; text?: string };
}

/** `base64(HMAC-SHA256(channel secret, raw body))` ต้องตรงกับ header `x-line-signature` */
export function lineSignatureValid(secret: string, rawBody: Buffer, signature: string): boolean {
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('base64'));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Webhook ของ LINE OA (`https://<WEB_DOMAIN>/api/v1/line/webhook` ใน LINE Developers Console)
 * ใช้อย่างเดียว: บอทถูกเชิญเข้ากลุ่ม (หรือมีคนพิมพ์ "group id" ในกลุ่ม) → ตอบ group ID ให้เอาไปตั้ง
 * `line_admin_group_id` — ข้อความอื่นไม่ทำอะไร (ไม่ใช่แชทบอท)
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('line')
export class LineWebhookController {
  private readonly logger = new Logger(LineWebhookController.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly line: LineMessagingProvider,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-line-signature') signature?: string,
  ): Promise<{ ok: true }> {
    const secret = this.config.get('LINE_MESSAGING_CHANNEL_SECRET');
    if (!secret) {
      throw new AppException(ErrorCode.SERVICE_UNAVAILABLE, 'LINE webhook is not configured');
    }
    if (!req.rawBody || !signature || !lineSignatureValid(secret, req.rawBody, signature)) {
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Invalid LINE signature');
    }

    const events = ((req.body as { events?: LineWebhookEvent[] }).events ?? []).slice(0, 20);
    for (const event of events) {
      await this.handle(event).catch((error: unknown) =>
        this.logger.warn(`LINE webhook event ${event.type} failed: ${String(error)}`),
      );
    }
    return { ok: true };
  }

  private async handle(event: LineWebhookEvent): Promise<void> {
    const groupId = event.source?.type === 'group' ? event.source.groupId : undefined;
    if (!groupId || !event.replyToken) return;
    const asked =
      event.type === 'join' ||
      (event.type === 'message' &&
        event.message?.type === 'text' &&
        /^group\s*id$/i.test(event.message.text?.trim() ?? ''));
    if (!asked) return;

    this.logger.log(`LINE group ${groupId} asked for its id (${event.type})`);
    await this.line.reply(event.replyToken, [
      {
        type: 'text',
        text: [
          'group ID ของกลุ่มนี้:',
          groupId,
          '',
          'นำไปใส่ที่ระบบหลังบ้าน → ตั้งค่าระบบ → "LINE กลุ่มเจ้าหน้าที่" เพื่อรับแจ้งเตือนผู้ค้าสมัครใหม่และสลิปใหม่',
        ].join('\n'),
      },
    ]);
  }
}
