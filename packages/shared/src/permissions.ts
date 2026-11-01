import { AdminRole } from './enums.js';

/** สิทธิ์ของ Admin (Overview §2) — API ใช้ตรวจ, หน้า admin ใช้ซ่อนเมนู */
export const Permission = {
  ADMIN_USERS_MANAGE: 'ADMIN_USERS_MANAGE',
  SETTINGS_MANAGE: 'SETTINGS_MANAGE',
  VENDORS_REVIEW: 'VENDORS_REVIEW',
  MARKET_LAYOUT_MANAGE: 'MARKET_LAYOUT_MANAGE',
  ROUNDS_MANAGE: 'ROUNDS_MANAGE',
  BOOKINGS_CANCEL: 'BOOKINGS_CANCEL',
  PAYMENTS_VERIFY: 'PAYMENTS_VERIFY',
  REPORTS_VIEW: 'REPORTS_VIEW',
  CHECKIN: 'CHECKIN',
  VENDOR_PHONE_VIEW: 'VENDOR_PHONE_VIEW',
  ANNOUNCEMENTS_MANAGE: 'ANNOUNCEMENTS_MANAGE',
  AUDIT_LOG_VIEW: 'AUDIT_LOG_VIEW',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const { SUPER_ADMIN, ADMIN, STAFF, FINANCE } = AdminRole;

/** ตาราง Permission ใน Overview §2 — แก้ที่นี่ที่เดียว */
export const PERMISSION_ROLES: Record<Permission, readonly AdminRole[]> = {
  ADMIN_USERS_MANAGE: [SUPER_ADMIN],
  SETTINGS_MANAGE: [SUPER_ADMIN, ADMIN],
  VENDORS_REVIEW: [SUPER_ADMIN, ADMIN, STAFF],
  MARKET_LAYOUT_MANAGE: [SUPER_ADMIN, ADMIN],
  ROUNDS_MANAGE: [SUPER_ADMIN, ADMIN],
  BOOKINGS_CANCEL: [SUPER_ADMIN, ADMIN, STAFF],
  PAYMENTS_VERIFY: [SUPER_ADMIN, ADMIN, FINANCE],
  REPORTS_VIEW: [SUPER_ADMIN, ADMIN, STAFF, FINANCE],
  CHECKIN: [SUPER_ADMIN, ADMIN, STAFF],
  /** เบอร์โทรเต็มในรายงาน/ไฟล์ export — ไม่มีสิทธิ์เห็นแบบปิดบางส่วน (PDPA §13) */
  VENDOR_PHONE_VIEW: [SUPER_ADMIN, ADMIN, STAFF],
  /** สร้าง/แก้/ลบประกาศ + ส่ง LINE ถึงผู้ค้าทุกคน (Phase 9.3) */
  ANNOUNCEMENTS_MANAGE: [SUPER_ADMIN, ADMIN],
  AUDIT_LOG_VIEW: [SUPER_ADMIN, ADMIN],
};

export function hasPermission(role: AdminRole, permission: Permission): boolean {
  return PERMISSION_ROLES[permission].includes(role);
}

export function permissionsOf(role: AdminRole): Permission[] {
  return (Object.keys(PERMISSION_ROLES) as Permission[]).filter((p) => hasPermission(role, p));
}
