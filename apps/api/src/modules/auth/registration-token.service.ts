import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { AppConfigService } from '../../config/app-config.service';
import { JWT_AUDIENCE, JWT_ISSUER, REGISTRATION_TOKEN_TTL_SECONDS } from './auth.constants';

/**
 * สิ่งที่ยืนยันแล้วก่อนสมัคร (เบอร์ผ่าน OTP และ/หรือ LINE) — POST /vendors/register (Phase 2.1) ใช้ค่านี้
 * แทนการเชื่อข้อมูลจาก client
 */
export interface RegistrationClaims {
  marketId: string;
  /** มีค่า = เบอร์นี้ยืนยัน OTP แล้ว */
  verifiedPhone?: string;
  lineUserId?: string;
  lineDisplayName?: string;
}

interface RegistrationPayload {
  typ: 'REGISTRATION';
  mkt: string;
  phn?: string;
  lid?: string;
  lnm?: string;
}

@Injectable()
export class RegistrationTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  sign(claims: RegistrationClaims): string {
    const payload: RegistrationPayload = {
      typ: 'REGISTRATION',
      mkt: claims.marketId,
      phn: claims.verifiedPhone,
      lid: claims.lineUserId,
      lnm: claims.lineDisplayName,
    };
    return this.jwt.sign(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: REGISTRATION_TOKEN_TTL_SECONDS,
      issuer: JWT_ISSUER,
      // audience ต่างจาก access token — ใช้ registration token เรียก API อื่นไม่ได้ และกลับกัน
      audience: JWT_AUDIENCE.REGISTRATION,
      algorithm: 'HS256',
    });
  }

  verify(token: string): RegistrationClaims {
    try {
      const p = this.jwt.verify<RegistrationPayload>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE.REGISTRATION,
        algorithms: ['HS256'],
      });
      if (p.typ !== 'REGISTRATION') throw new Error('wrong type');
      return { marketId: p.mkt, verifiedPhone: p.phn, lineUserId: p.lid, lineDisplayName: p.lnm };
    } catch {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Registration session expired, please verify again',
      );
    }
  }
}
