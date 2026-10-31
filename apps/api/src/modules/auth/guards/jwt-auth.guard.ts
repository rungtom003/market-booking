import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@market-booking/shared';
import type { Request } from 'express';
import { AppException } from '../../../common/exceptions/app.exception';
import { setRequestActor } from '../../../common/request-context';
import { IS_PUBLIC } from '../decorators';
import { TokenService } from '../token.service';

/**
 * Global guard: ทุก endpoint ต้องมี access token (`Authorization: Bearer …`) ยกเว้นที่ติด @Public()
 * ตั้งค่าแบบ "ปิดไว้ก่อน" เพื่อไม่ให้ endpoint ใหม่ที่ลืมใส่ guard เปิดโล่ง
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
    const principal = scheme === 'Bearer' && token ? this.tokens.verifyAccessToken(token) : null;
    if (!principal) {
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Missing or invalid access token');
    }

    req.principal = principal;
    setRequestActor({ type: principal.actorType, id: principal.id });
    return true;
  }
}
