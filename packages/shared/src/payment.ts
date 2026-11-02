import { z } from 'zod';
import type { BookingStatus, PaymentMethod } from './enums.js';
import { PaymentStatus } from './enums.js';
import { priceSchema } from './market.js';
import { paginationQuerySchema } from './pagination.js';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from './vendor.js';

export const PAYMENT_STATUS_TH: Record<PaymentStatus, string> = {
  PENDING: 'รอตรวจ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่ผ่าน',
};

export const PAYMENT_METHOD_TH: Record<PaymentMethod, string> = {
  PROMPTPAY_SLIP: 'โอนพร้อมเพย์ (สลิป)',
  CASH: 'เงินสด',
};

/** ขอ URL อัปโหลดสลิป (presigned PUT) — รูป JPEG/PNG/WebP ≤ 5 MB เหมือนรูปผู้ค้า */
export const slipUploadRequestSchema = z
  .object({
    contentType: z.enum(ALLOWED_IMAGE_TYPES),
    size: z.number().int().min(1).max(MAX_UPLOAD_BYTES, 'ไฟล์ต้องไม่เกิน 5 MB'),
  })
  .strict();
export type SlipUploadRequestInput = z.infer<typeof slipUploadRequestSchema>;

/** ส่งสลิปที่อัปโหลดแล้ว → การจองเป็น PENDING_VERIFY */
export const submitSlipSchema = z.object({ slipImageKey: z.string().min(1).max(255) }).strict();
export type SubmitSlipInput = z.infer<typeof submitSlipSchema>;

/** ไม่ผ่าน — ผู้ค้าเห็นเหตุผลและส่งสลิปใหม่ได้ */
export const rejectPaymentSchema = z
  .object({ reason: z.string().trim().min(3, 'กรุณาระบุเหตุผล (อย่างน้อย 3 ตัวอักษร)').max(500) })
  .strict();
export type RejectPaymentInput = z.infer<typeof rejectPaymentSchema>;

/** Admin บันทึกรับเงินสดหน้างาน — ไม่ระบุยอด = ยอดของการจอง */
export const recordCashPaymentSchema = z
  .object({ bookingId: z.uuid(), amount: priceSchema.optional() })
  .strict();
export type RecordCashPaymentInput = z.infer<typeof recordCashPaymentSchema>;

export const adminPaymentListQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum([PaymentStatus.PENDING, PaymentStatus.APPROVED, PaymentStatus.REJECTED])
    .optional(),
});
export type AdminPaymentListQuery = z.infer<typeof adminPaymentListQuerySchema>;

export interface PaymentRecord {
  id: string;
  method: PaymentMethod;
  amount: number;
  status: PaymentStatus;
  rejectReason: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

/** `GET /bookings/:id/payment` — ข้อมูลชำระเงินของการจอง (ผู้ค้าเจ้าของเท่านั้น) */
export interface BookingPaymentInfo {
  bookingId: string;
  bookingStatus: BookingStatus;
  amount: number;
  paymentDueAt: string | null;
  /** null = ตลาดยังไม่ได้ตั้ง `promptpay_id` (ชำระเงินสดกับเจ้าหน้าที่) */
  promptpay: { id: string; payload: string } | null;
  /** ใหม่สุดก่อน — รวมที่ไม่ผ่าน (ประวัติครบ) */
  payments: PaymentRecord[];
}

/**
 * ผลตรวจสลิปอัตโนมัติ (Phase 11.2) — ระบบตรวจรูปซ้ำเองเสมอ, ที่เหลือมาจากผู้ให้บริการ (SlipOK)
 * null = ยังไม่ได้ตรวจ/ไม่มีผู้ให้บริการ (เจ้าหน้าที่ตรวจเอง)
 */
export const SlipCheck = {
  VALID: 'VALID',
  /** รูปเดียวกันหรือเลขอ้างอิงธุรกรรมเดียวกันเคยใช้ชำระแล้ว */
  DUPLICATE: 'DUPLICATE',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  RECEIVER_MISMATCH: 'RECEIVER_MISMATCH',
  /** QR บนสลิปหมดอายุ/ไม่มีรายการจริง */
  NOT_FOUND: 'NOT_FOUND',
  /** อ่าน QR บนรูปไม่ได้ / ไม่ใช่สลิป — ให้เจ้าหน้าที่ดู */
  UNREADABLE: 'UNREADABLE',
  /** ธนาคารยังไม่อัปเดตรายการ — ให้เจ้าหน้าที่ดู */
  BANK_DELAY: 'BANK_DELAY',
  /** ผู้ให้บริการขัดข้อง/โควตาหมด — ให้เจ้าหน้าที่ดู */
  ERROR: 'ERROR',
} as const;
export type SlipCheck = (typeof SlipCheck)[keyof typeof SlipCheck];

export const SLIP_CHECK_TH: Record<SlipCheck, string> = {
  VALID: 'ระบบตรวจแล้ว: ถูกต้อง',
  DUPLICATE: 'สลิปซ้ำ — เคยใช้ชำระแล้ว',
  AMOUNT_MISMATCH: 'ยอดเงินบนสลิปไม่ตรงกับยอดที่ต้องชำระ',
  RECEIVER_MISMATCH: 'โอนเข้าบัญชีที่ไม่ใช่ของตลาด',
  NOT_FOUND: 'ไม่พบรายการโอนนี้ในระบบธนาคาร',
  UNREADABLE: 'ระบบอ่าน QR บนสลิปไม่ได้ — กรุณาตรวจเอง',
  BANK_DELAY: 'ธนาคารยังไม่อัปเดตรายการ — กรุณาตรวจเอง',
  ERROR: 'ระบบตรวจสลิปขัดข้อง — กรุณาตรวจเอง',
};

export interface AdminPayment extends PaymentRecord {
  /** ผลตรวจอัตโนมัติ (Phase 11.2) */
  slipCheck: SlipCheck | null;
  /** รูปสลิปเดียวกันเคยส่งมากับการชำระอื่น (ล่าสุด) — เตือนเจ้าหน้าที่ */
  duplicateOf: {
    paymentId: string;
    status: PaymentStatus;
    stallCode: string;
    marketDate: string;
    vendorName: string;
  } | null;
  /** presigned GET อายุสั้น (สลิป) — เงินสด = null */
  slipUrl: string | null;
  verifiedByName: string | null;
  booking: {
    id: string;
    status: BookingStatus;
    amount: number;
    stallCode: string;
    marketDate: string;
    paymentDueAt: string | null;
  };
  vendor: { id: string; name: string; phone: string };
}
