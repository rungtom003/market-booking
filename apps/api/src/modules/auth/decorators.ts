import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import { AdminRole, ErrorCode, PERMISSION_ROLES, Permission } from '@market-booking/shared';
import type { Request } from 'express';
import { AppException } from '../../common/exceptions/app.exception';
import type { AdminPrincipal, Principal, VendorPrincipal } from './principal';

export const IS_PUBLIC = 'auth:public';
export const ALLOWED_ROLES = 'auth:roles';
export const ALLOWED_ACTORS = 'auth:actors';

/** endpoint ที่ไม่ต้อง login (ค่าเริ่มต้นของทุก endpoint คือต้อง login) */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** เฉพาะ Admin ที่มี role ตามที่ระบุ */
export const Roles = (...roles: AdminRole[]) => SetMetadata(ALLOWED_ROLES, roles);

/** เฉพาะ Admin ที่มีสิทธิ์นี้ตามตาราง Permission (Overview §2) — ใช้ตัวนี้แทน @Roles เมื่อทำได้ */
export const RequirePermission = (permission: Permission) => Roles(...PERMISSION_ROLES[permission]);

/** จำกัดประเภทผู้ใช้ เช่น `@ActorTypes('VENDOR')` สำหรับ endpoint ของผู้ค้า */
export const ActorTypes = (...types: Principal['actorType'][]) =>
  SetMetadata(ALLOWED_ACTORS, types);

function principalOf(ctx: ExecutionContext): Principal | undefined {
  return ctx.switchToHttp().getRequest<Request>().principal;
}

/** ดึง Admin ที่ login อยู่ — ถ้าไม่ใช่ admin โยน 403 (กันใส่ผิด controller) */
export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AdminPrincipal => {
    const principal = principalOf(ctx);
    if (principal?.actorType !== 'ADMIN') throw new AppException(ErrorCode.FORBIDDEN);
    return principal;
  },
);

export const CurrentVendor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): VendorPrincipal => {
    const principal = principalOf(ctx);
    if (principal?.actorType !== 'VENDOR') throw new AppException(ErrorCode.FORBIDDEN);
    return principal;
  },
);
