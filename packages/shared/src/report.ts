import { z } from 'zod';
import { type ActorType, type RoundPhase, type VendorStatus } from './enums.js';
import { paginationQuerySchema } from './pagination.js';
import { isoDateSchema } from './round.js';

// ───────────── ช่วงเวลา ─────────────

/** รายงานดูได้ไม่เกินนี้ต่อครั้ง (ข้อมูล ~1 ปี + เผื่อ) */
export const MAX_REPORT_DAYS = 400;

const DAY_MS = 86_400_000;
const rangeDays = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;

/** วันขายตั้งแต่ `from` ถึง `to` (รวมทั้งสองวัน, `YYYY-MM-DD`) + เลือกรอบได้ */
const rangeShape = {
  from: isoDateSchema,
  to: isoDateSchema,
  roundId: z.uuid().optional(),
};

type Range = { from: string; to: string };

/** `from` ≤ `to` และไม่เกิน MAX_REPORT_DAYS วัน */
function withRange<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({ ...rangeShape, ...shape })
    .refine((q) => (q as Range).from <= (q as Range).to, {
      message: 'วันเริ่มต้องไม่หลังวันสิ้นสุด',
      path: ['to'],
    })
    .refine((q) => rangeDays((q as Range).from, (q as Range).to) <= MAX_REPORT_DAYS, {
      message: `ดูได้ครั้งละไม่เกิน ${MAX_REPORT_DAYS} วัน`,
      path: ['from'],
    });
}

/** `json` แสดงบนหน้าเว็บ, `xlsx`/`csv` ดาวน์โหลด (ลง audit log) */
export const reportFormatSchema = z.enum(['json', 'xlsx', 'csv']).default('json');
export type ReportFormat = z.infer<typeof reportFormatSchema>;

// ───────────── รายได้ ─────────────

export const RevenueGroupBy = { DAY: 'day', ROUND: 'round', ZONE: 'zone' } as const;
export type RevenueGroupBy = (typeof RevenueGroupBy)[keyof typeof RevenueGroupBy];

export const revenueReportQuerySchema = withRange({
  groupBy: z.enum(['day', 'round', 'zone']).default('day'),
  format: reportFormatSchema,
});
export type RevenueReportQuery = z.infer<typeof revenueReportQuerySchema>;

/**
 * รายได้ = ยอดชำระที่อนุมัติแล้ว (สลิป + เงินสด) ของการจองในวันขายช่วงนั้น
 * (การคืนเงินทำนอกระบบ — ไม่หักออก; การจองแบบไม่ต้องชำระไม่มีรายได้)
 */
export interface RevenueRow {
  /** วันที่ `YYYY-MM-DD` / id รอบ / id โซน */
  key: string;
  label: string;
  /** จำนวนการจองที่มียอดชำระอนุมัติแล้ว */
  bookings: number;
  revenue: number;
  promptpay: number;
  cash: number;
}

export interface RevenueReport {
  groupBy: RevenueGroupBy;
  from: string;
  to: string;
  rows: RevenueRow[];
  total: Omit<RevenueRow, 'key' | 'label'>;
}

// ───────────── การใช้ล็อค ─────────────

export const occupancyReportQuerySchema = withRange({
  groupBy: z.enum(['day', 'zone']).default('day'),
  format: reportFormatSchema,
});
export type OccupancyReportQuery = z.infer<typeof occupancyReportQuerySchema>;

/** ล็อคที่ใช้ได้ = ล็อคที่เปิดใช้งาน (ปัจจุบัน) ลบที่ปิดเฉพาะวัน × วันขายที่ไม่ยกเลิก */
export interface OccupancyRow {
  key: string;
  label: string;
  capacity: number;
  /** จองสำเร็จ */
  confirmed: number;
  /** รอยืนยัน/ชำระ/ตรวจสลิป */
  pending: number;
  /** confirmed / capacity (0–1) */
  rate: number;
}

export interface OccupancyReport {
  groupBy: 'day' | 'zone';
  from: string;
  to: string;
  rows: OccupancyRow[];
  total: Omit<OccupancyRow, 'key' | 'label'>;
}

// ───────────── ผู้ค้า ─────────────

export const vendorReportQuerySchema = withRange({
  sort: z.enum(['bookings', 'revenue', 'cancelled', 'noshow']).default('bookings'),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  format: reportFormatSchema,
});
export type VendorReportQuery = z.infer<typeof vendorReportQuerySchema>;

export interface VendorReportRow {
  vendorId: string;
  name: string;
  shopName: string | null;
  /** ปิดบางส่วนถ้าไม่มีสิทธิ์ `VENDOR_PHONE_VIEW` เช่น 081-xxx-5678 */
  phone: string;
  status: VendorStatus;
  /** จองสำเร็จในช่วงนั้น */
  bookings: number;
  /** ยกเลิก (ผู้ค้าเอง/เจ้าหน้าที่) + หมดเวลา ในช่วงนั้น */
  cancelled: number;
  revenue: number;
  /** ไม่มาขายสะสมทั้งหมด (ไม่ขึ้นกับช่วงวันที่) */
  noshowCount: number;
}

export interface VendorReport {
  from: string;
  to: string;
  sort: VendorReportQuery['sort'];
  phoneMasked: boolean;
  rows: VendorReportRow[];
}

// ───────────── Dashboard ─────────────

export interface DashboardRound {
  id: string;
  name: string;
  phase: RoundPhase | null;
  openAt: string;
  closeAt: string;
  marketDays: number;
  capacity: number;
  confirmed: number;
  pending: number;
  /** confirmed / capacity (0–1) */
  occupancyRate: number;
  /** ยอดชำระที่อนุมัติแล้ว */
  revenue: number;
  /** ยอดของการจองที่ยังรอชำระ/รอตรวจ */
  revenuePending: number;
}

export interface Dashboard {
  pendingVendors: number;
  pendingPayments: number;
  /** รอบที่กำลังเปิด/จะเปิด (ใกล้สุด) — ไม่มีก็เป็นรอบล่าสุดที่ปิดแล้ว */
  round: DashboardRound | null;
}

// ───────────── Audit log ─────────────

export const auditLogQuerySchema = paginationQuerySchema
  .extend({
    actorType: z.enum(['ADMIN', 'VENDOR', 'SYSTEM']).optional(),
    actorId: z.uuid().optional(),
    /** ตรงทั้งคำ เช่น `vendor.approve` หรือขึ้นต้น เช่น `vendor.` */
    action: z.string().trim().max(100).optional(),
    entityType: z.string().trim().max(50).optional(),
    entityId: z.uuid().optional(),
    /** วันที่ตามเวลาไทย (รวมทั้งสองวัน) */
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'วันเริ่มต้องไม่หลังวันสิ้นสุด',
    path: ['to'],
  });
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export interface AuditLogEntry {
  id: string;
  createdAt: string;
  actorType: ActorType;
  actorId: string | null;
  /** ชื่อ admin / ผู้ค้า ณ ตอนนี้ (null = SYSTEM หรือถูกลบ) */
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
}

/** ชื่อ action ภาษาไทยที่พบบ่อย — ตัวที่ไม่มีแสดงชื่อเดิม */
export const AUDIT_ACTION_TH: Record<string, string> = {
  'auth.login': 'เข้าสู่ระบบ',
  'admin_user.create': 'เพิ่มผู้ดูแลระบบ',
  'admin_user.update': 'แก้ผู้ดูแลระบบ',
  'admin_user.reset_password_cli': 'รีเซ็ตรหัสผ่าน (สคริปต์)',
  'settings.update': 'แก้ตั้งค่าระบบ',
  'vendor.register': 'ผู้ค้าสมัคร',
  'vendor.update': 'ผู้ค้าแก้ข้อมูล',
  'vendor.link_line': 'ผู้ค้าผูก LINE',
  'vendor.approve': 'อนุมัติผู้ค้า',
  'vendor.reject': 'ไม่อนุมัติผู้ค้า',
  'vendor.suspend': 'ระงับผู้ค้า',
  'vendor.unsuspend': 'ปลดระงับผู้ค้า',
  'vendor.suspension_expired': 'หมดเวลาระงับ',
  'zone.create': 'เพิ่มโซน',
  'zone.update': 'แก้โซน',
  'zone.delete': 'ลบโซน',
  'product_category.create': 'เพิ่มประเภทสินค้า',
  'product_category.update': 'แก้ประเภทสินค้า',
  'product_category.delete': 'ลบประเภทสินค้า',
  'stall.create': 'เพิ่มล็อค',
  'stall.bulk_create': 'สร้างหลายล็อค',
  'stall.update': 'แก้ล็อค',
  'stall.delete': 'ลบล็อค',
  'round.create': 'สร้างรอบ',
  'round.update': 'แก้รอบ',
  'round.publish': 'เผยแพร่รอบ',
  'round.cancel': 'ยกเลิกรอบ',
  'round.delete': 'ลบรอบ',
  'market_day.add': 'เพิ่มวันขาย',
  'market_day.cancel': 'ยกเลิกวันขาย',
  'market_day.restore': 'คืนวันขาย',
  'market_day.delete': 'ลบวันขาย',
  'stall_day_override.set': 'ตั้งค่าล็อครายวัน',
  'stall_day_override.delete': 'ล้างค่าล็อครายวัน',
  'booking.create_by_admin': 'จองแทนผู้ค้า',
  'booking.cancel': 'ยกเลิกการจอง',
  'booking.expire': 'การจองหมดเวลา',
  'booking.export': 'ดาวน์โหลดรายชื่อผู้ค้า',
  'payment.submit': 'ส่งสลิป',
  'payment.approve': 'อนุมัติสลิป',
  'payment.reject': 'สลิปไม่ผ่าน',
  'payment.cash': 'รับเงินสด',
  'report.export': 'ดาวน์โหลดรายงาน',
};

/** 0812345678 → 081-xxx-5678 (รายงานสำหรับผู้ที่ไม่มีสิทธิ์ดูเบอร์เต็ม — Overview §13 PDPA) */
export function maskPhone(phone: string): string {
  return phone.length === 10 ? `${phone.slice(0, 3)}-xxx-${phone.slice(6)}` : 'xxx';
}
