import type { AdminRole } from '@market-booking/shared';

/** ผู้ใช้ที่ login แล้ว (มาจาก access token) — ติดอยู่ที่ `req.principal` */
export interface AdminPrincipal {
  actorType: 'ADMIN';
  id: string;
  role: AdminRole;
  /** null = SUPER_ADMIN (ทุกตลาด) */
  marketId: string | null;
}

export interface VendorPrincipal {
  actorType: 'VENDOR';
  id: string;
  marketId: string;
}

export type Principal = AdminPrincipal | VendorPrincipal;

/** payload ของ access token (JWT) — ใส่เฉพาะที่ guard ต้องใช้ ห้ามใส่ข้อมูลส่วนตัว */
export interface AccessTokenPayload {
  sub: string;
  typ: Principal['actorType'];
  role?: AdminRole;
  mkt: string | null;
}

// เพิ่มที่ IncomingMessage (แม่ของ express Request) — ใช้ได้ทั้งใน guard และ pino-http
declare module 'http' {
  interface IncomingMessage {
    principal?: Principal;
  }
}
