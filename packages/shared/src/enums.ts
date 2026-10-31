// Enum ของระบบ (Overview §7.1) — ใช้ทั้ง api และ frontend
// ค่าต้องตรงกับ enum ใน apps/api/prisma/schema.prisma (มี test ตรวจที่ apps/api/src/prisma/enums.spec.ts)

export const VendorStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type VendorStatus = (typeof VendorStatus)[keyof typeof VendorStatus];

export const AdminRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  STAFF: 'STAFF',
  FINANCE: 'FINANCE',
} as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

/** สถานะเปิด/ปิดจองไม่อยู่ในนี้ — คำนวณจากเวลา (ดู RoundPhase) */
export const RoundStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  CANCELLED: 'CANCELLED',
} as const;
export type RoundStatus = (typeof RoundStatus)[keyof typeof RoundStatus];

/** สถานะที่คำนวณจาก PUBLISHED + เวลา server (Overview §8.3) — ไม่เก็บใน DB */
export const RoundPhase = {
  UPCOMING: 'UPCOMING',
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
} as const;
export type RoundPhase = (typeof RoundPhase)[keyof typeof RoundPhase];

export const BookingStatus = {
  HOLD: 'HOLD',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PENDING_VERIFY: 'PENDING_VERIFY',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

/** Booking ที่ยึดล็อคอยู่ — ต้องตรงกับ predicate ของ uq_active_booking */
export const ACTIVE_BOOKING_STATUSES = [
  BookingStatus.HOLD,
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.PENDING_VERIFY,
  BookingStatus.CONFIRMED,
] as const satisfies readonly BookingStatus[];

export const PaymentStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

/** เก็บเป็น varchar ใน payments.method */
export const PaymentMethod = {
  PROMPTPAY_SLIP: 'PROMPTPAY_SLIP',
  CASH: 'CASH',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const WaitlistStatus = {
  WAITING: 'WAITING',
  NOTIFIED: 'NOTIFIED',
  FULFILLED: 'FULFILLED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type WaitlistStatus = (typeof WaitlistStatus)[keyof typeof WaitlistStatus];

/** ค่าของ setting `registration_mode` — ไม่ใช่ column ใน DB */
export const RegistrationMode = {
  AUTO: 'AUTO',
  MANUAL: 'MANUAL',
} as const;
export type RegistrationMode = (typeof RegistrationMode)[keyof typeof RegistrationMode];

/** เก็บเป็น varchar ใน audit_logs.actor_type */
export const ActorType = {
  ADMIN: 'ADMIN',
  VENDOR: 'VENDOR',
  SYSTEM: 'SYSTEM',
} as const;
export type ActorType = (typeof ActorType)[keyof typeof ActorType];
