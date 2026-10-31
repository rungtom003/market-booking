import { Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@market-booking/shared';
import { AppException } from '../../../common/exceptions/app.exception';
import { AppConfigService } from '../../../config/app-config.service';

/** inject ด้วย `@Inject(LINE_ID_TOKEN_VERIFIER)` — test override เป็น mock ได้ */
export const LINE_ID_TOKEN_VERIFIER = Symbol('LINE_ID_TOKEN_VERIFIER');

export interface LineIdentity {
  /** LINE user id (`sub`) — ผูกกับ vendors.line_user_id */
  userId: string;
  displayName?: string;
}

export interface LineIdTokenVerifier {
  /** ID token ผิด/หมดอายุ → UNAUTHORIZED; ยังไม่ได้ตั้งค่า/LINE ล่ม → SERVICE_UNAVAILABLE */
  verify(idToken: string): Promise<LineIdentity>;
}

export const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';

interface LineVerifyResponse {
  sub?: string;
  aud?: string;
  exp?: number;
  name?: string;
}

/**
 * ตรวจ ID token จาก LIFF กับ LINE โดยตรง (ไม่เชื่อข้อมูลผู้ใช้ที่ client ส่งมา)
 * https://developers.line.biz/en/reference/line-login/#verify-id-token
 */
@Injectable()
export class HttpLineIdTokenVerifier implements LineIdTokenVerifier {
  private readonly logger = new Logger(HttpLineIdTokenVerifier.name);

  constructor(private readonly config: AppConfigService) {}

  async verify(idToken: string): Promise<LineIdentity> {
    const channelId = this.config.get('LINE_LOGIN_CHANNEL_ID');
    if (!channelId) {
      throw new AppException(ErrorCode.SERVICE_UNAVAILABLE, 'LINE Login is not configured');
    }

    let res: Response;
    try {
      res = await fetch(LINE_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      this.logger.error(`LINE verify request failed: ${String(error)}`);
      throw new AppException(ErrorCode.SERVICE_UNAVAILABLE, 'LINE is not reachable, try again');
    }

    // LINE ตอบ 400 เมื่อ token ผิด/หมดอายุ/ไม่ใช่ของ channel นี้
    if (res.status === 400) throw this.invalid();
    if (!res.ok) {
      this.logger.error(`LINE verify returned HTTP ${res.status}`);
      throw new AppException(ErrorCode.SERVICE_UNAVAILABLE, 'LINE is not reachable, try again');
    }

    const body = (await res.json()) as LineVerifyResponse;
    // ตรวจซ้ำฝั่งเรา เผื่อ LINE เปลี่ยนพฤติกรรม
    if (!body.sub || body.aud !== channelId || !body.exp || body.exp * 1000 < Date.now()) {
      throw this.invalid();
    }
    return { userId: body.sub, displayName: body.name };
  }

  private invalid(): AppException {
    return new AppException(ErrorCode.UNAUTHORIZED, 'Invalid or expired LINE token');
  }
}
