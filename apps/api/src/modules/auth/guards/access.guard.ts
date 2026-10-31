import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { API_PREFIX, AdminRole, ErrorCode } from '@market-booking/shared';
import type { Request } from 'express';
import { AppException } from '../../../common/exceptions/app.exception';
import { ALLOWED_ACTORS, ALLOWED_ROLES } from '../decorators';
import type { Principal } from '../principal';

const ADMIN_PATH_PREFIX = `${API_PREFIX}/admin/`;

/** Global guard (ต่อจาก JwtAuthGuard): ตรวจประเภทผู้ใช้และ role ตาม @ActorTypes / @Roles / @RequirePermission */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<Request>();
    const principal = req.principal;
    if (!principal) return true; // endpoint @Public()

    const targets = [context.getHandler(), context.getClass()];
    const roles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ALLOWED_ROLES, targets);
    const actors = this.reflector.getAllAndOverride<Principal['actorType'][] | undefined>(
      ALLOWED_ACTORS,
      targets,
    );

    // กันพลาดชั้นที่สอง: ทุก path /admin/* เป็นของ admin เท่านั้น แม้ controller จะลืมใส่ @Roles
    if (req.path.startsWith(ADMIN_PATH_PREFIX) && principal.actorType !== 'ADMIN') {
      throw this.forbidden();
    }
    if (actors && !actors.includes(principal.actorType)) throw this.forbidden();
    if (roles && (principal.actorType !== 'ADMIN' || !roles.includes(principal.role))) {
      throw this.forbidden();
    }
    return true;
  }

  private forbidden(): AppException {
    return new AppException(ErrorCode.FORBIDDEN, 'You do not have permission to do this');
  }
}
