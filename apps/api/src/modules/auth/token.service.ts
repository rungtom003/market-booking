import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from '../../config/app-config.service';
import { ACCESS_TOKEN_TTL_SECONDS, JWT_AUDIENCE, JWT_ISSUER } from './auth.constants';
import type { AccessTokenPayload, Principal } from './principal';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  signAccessToken(principal: Principal): string {
    const payload: AccessTokenPayload = {
      sub: principal.id,
      typ: principal.actorType,
      mkt: principal.marketId,
      ...(principal.actorType === 'ADMIN' ? { role: principal.role } : {}),
    };
    return this.jwt.sign(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE.ACCESS,
      algorithm: 'HS256',
    });
  }

  /** คืน null เมื่อ token ผิด/หมดอายุ/ปลอม — guard แปลงเป็น 401 */
  verifyAccessToken(token: string): Principal | null {
    let payload: AccessTokenPayload;
    try {
      payload = this.jwt.verify<AccessTokenPayload>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE.ACCESS,
        // ระบุ algorithm ตายตัว กัน token ที่เปลี่ยน alg (เช่น none)
        algorithms: ['HS256'],
      });
    } catch {
      return null;
    }

    if (payload.typ === 'ADMIN' && payload.role) {
      return { actorType: 'ADMIN', id: payload.sub, role: payload.role, marketId: payload.mkt };
    }
    if (payload.typ === 'VENDOR' && payload.mkt) {
      return { actorType: 'VENDOR', id: payload.sub, marketId: payload.mkt };
    }
    return null;
  }
}
