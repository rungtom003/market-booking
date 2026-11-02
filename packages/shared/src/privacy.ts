import { z } from 'zod';
import type { BookingStatus, PaymentStatus, VendorStatus } from './enums.js';

/**
 * PDPA (Phase 11.3) — ผู้ค้าขอสำเนาข้อมูลของตัวเอง (`GET /vendors/me/export`)
 * และลบบัญชี (`DELETE /vendors/me`): ข้อมูลส่วนบุคคลถูกลบ/ทำให้ระบุตัวไม่ได้ ส่วนประวัติการจอง/ชำระ
 * (ยอด วันที่ ล็อค) เก็บไว้สำหรับบัญชีของตลาดโดยไม่ผูกกับตัวบุคคล
 */

/** ยืนยันการลบด้วยเบอร์โทรของบัญชี (กันกดพลาด) */
export const deleteMyAccountSchema = z
  .object({ confirmPhone: z.string().trim().min(1, 'กรุณากรอกเบอร์โทรของบัญชีเพื่อยืนยัน') })
  .strict();
export type DeleteMyAccountInput = z.infer<typeof deleteMyAccountSchema>;

/** เจ้าหน้าที่ลบข้อมูลตามคำขอ (เช่น ผู้ค้าโทรมาขอ) — ต้องบันทึกเหตุผล */
export const eraseVendorSchema = z
  .object({ reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล/ช่องทางที่ได้รับคำขอ').max(500) })
  .strict();
export type EraseVendorInput = z.infer<typeof eraseVendorSchema>;

/** ชื่อที่แสดงแทนผู้ค้าที่ลบข้อมูลแล้ว */
export const ERASED_VENDOR_NAME = 'ผู้ใช้ที่ลบข้อมูลแล้ว';

/** ระยะเวลาเก็บข้อมูล (นโยบาย — `RetentionService` ลบตามนี้ทุกวัน) */
export const RETENTION_DAYS = {
  /** ประวัติข้อความแจ้งเตือน (มีเบอร์/ LINE ID ของผู้รับ) */
  notificationLogs: 180,
  /** รูปสลิป (มีชื่อ/เลขบัญชีผู้โอน) — นับจากวันขาย; ยอดและสถานะการชำระยังเก็บ */
  slipImages: 365,
  /** ผู้ค้าที่ถูกปฏิเสธและไม่ได้แก้ไขส่งใหม่ — ลบข้อมูลส่วนบุคคล */
  rejectedVendors: 180,
} as const;

/** ไฟล์ "ข้อมูลของฉัน" (JSON) */
export interface VendorDataExport {
  exportedAt: string;
  profile: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    phoneVerifiedAt: string | null;
    lineLinked: boolean;
    address: string;
    shopName: string | null;
    productCategory: string | null;
    status: VendorStatus;
    rejectReason: string | null;
    suspendedUntil: string | null;
    noshowCount: number;
    pdpaConsentAt: string;
    createdAt: string;
  };
  /** ลิงก์ดาวน์โหลดรูปที่แนบไว้ (หมดอายุภายใน 5 นาที) */
  images: { idCard: string | null; shop: string | null };
  bookings: {
    id: string;
    marketDate: string;
    stallCode: string;
    zoneName: string;
    status: BookingStatus;
    amount: number;
    createdAt: string;
    confirmedAt: string | null;
    cancelledAt: string | null;
    cancelReason: string | null;
    checkedInAt: string | null;
    noshow: boolean;
    payments: {
      method: string;
      amount: number;
      status: PaymentStatus;
      rejectReason: string | null;
      createdAt: string;
      /** ลิงก์รูปสลิป (หมดอายุภายใน 5 นาที) — ลบตามนโยบายแล้ว = null */
      slipUrl: string | null;
    }[];
  }[];
  waitlists: { marketDate: string; target: string; status: string; createdAt: string }[];
  notifications: { channel: string; template: string; status: string; createdAt: string }[];
}
