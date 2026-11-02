import { z } from 'zod';
import type { AccessTokenResponse } from './auth.js';
import { VendorStatus } from './enums.js';
import { paginationQuerySchema } from './pagination.js';
import { thaiMobilePhoneSchema } from './vendor-auth.js';
import type { VendorSummary } from './vendor-auth.js';

// ───────────── Upload (Overview §13: ≤ 5 MB, private bucket, presigned URL) ─────────────

export const VendorImageKind = { ID_CARD: 'ID_CARD', SHOP: 'SHOP' } as const;
export type VendorImageKind = (typeof VendorImageKind)[keyof typeof VendorImageKind];

/** frontend แปลง/บีบอัดรูปเป็นชนิดเหล่านี้ก่อนอัปโหลด (HEIC จาก iPhone ต้องแปลงก่อน) */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const uploadRequestSchema = z.object({
  kind: z.enum([VendorImageKind.ID_CARD, VendorImageKind.SHOP]),
  contentType: z.enum(ALLOWED_IMAGE_TYPES),
  /** byte — ต้องตรงกับไฟล์ที่ส่งจริง (ลงลายเซ็นใน URL) */
  size: z.number().int().min(1).max(MAX_UPLOAD_BYTES, 'ไฟล์ต้องไม่เกิน 5 MB'),
});
export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;

/** อัปโหลดระหว่างสมัคร (ยังไม่มีบัญชี) — ยืนยันตัวด้วย registrationToken */
export const registrationUploadRequestSchema = uploadRequestSchema.extend({
  registrationToken: z.string().min(1).max(2000),
});
export type RegistrationUploadRequestInput = z.infer<typeof registrationUploadRequestSchema>;

/** client ต้อง `PUT url` พร้อม headers ตามนี้ทุกตัว แล้วส่ง `key` ไปกับฟอร์ม */
export interface UploadTicket {
  key: string;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  /** วินาที */
  expiresIn: number;
}

// ───────────── Register / profile ─────────────

const imageKeySchema = z.string().max(255);

const profileFields = {
  firstName: z.string().trim().min(1, 'กรุณากรอกชื่อ').max(100),
  lastName: z.string().trim().min(1, 'กรุณากรอกนามสกุล').max(100),
  address: z.string().trim().min(5, 'กรุณากรอกที่อยู่ (อย่างน้อย 5 ตัวอักษร)').max(500),
  shopName: z.string().trim().max(200).nullish(),
  productCategoryId: z.uuid().nullish(),
  idCardImageKey: imageKeySchema.nullish(),
  shopImageKey: imageKeySchema.nullish(),
};

export const vendorRegisterSchema = z.object({
  registrationToken: z.string().min(1).max(2000),
  /** ใช้เมื่อมาทาง LINE (ยังไม่ได้ยืนยันเบอร์) — มาทาง OTP ใช้เบอร์ที่ยืนยันแล้วจาก token เสมอ */
  phone: thaiMobilePhoneSchema.optional(),
  ...profileFields,
  pdpaConsent: z.literal(true, { error: 'กรุณายอมรับนโยบายความเป็นส่วนตัว' }),
});
export type VendorRegisterInput = z.infer<typeof vendorRegisterSchema>;

/** แก้ข้อมูลตัวเอง — เปลี่ยนเบอร์ต้องยืนยัน OTP (ยังไม่รองรับ) */
export const updateVendorProfileSchema = z
  .object(profileFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'ไม่มีข้อมูลที่เปลี่ยนแปลง');
export type UpdateVendorProfileInput = z.infer<typeof updateVendorProfileSchema>;

export interface VendorProfile {
  id: string;
  marketId: string;
  firstName: string;
  lastName: string;
  phone: string;
  phoneVerified: boolean;
  lineLinked: boolean;
  address: string;
  shopName: string | null;
  productCategory: { id: string; name: string } | null;
  status: VendorStatus;
  rejectReason: string | null;
  suspendedUntil: string | null;
  /** presigned GET อายุสั้น — null = ไม่ได้แนบ */
  idCardImageUrl: string | null;
  shopImageUrl: string | null;
  createdAt: string;
}

/** ข้อมูลที่ฟอร์มสมัคร/แก้โปรไฟล์ต้องใช้ */
export interface VendorFormOptions {
  requireIdCardImage: boolean;
  requireShopImage: boolean;
  productCategories: { id: string; name: string }[];
}

export const registrationOptionsSchema = z.object({
  registrationToken: z.string().min(1).max(2000),
});

export type VendorRegisterResponse = {
  status: 'LOGGED_IN';
  vendor: VendorSummary;
} & AccessTokenResponse;

// ───────────── Admin ─────────────

const vendorStatusSchema = z.enum([
  VendorStatus.PENDING,
  VendorStatus.APPROVED,
  VendorStatus.REJECTED,
  VendorStatus.SUSPENDED,
]);

export const adminVendorListQuerySchema = paginationQuerySchema.extend({
  status: vendorStatusSchema.optional(),
  /** ค้นหาชื่อ / นามสกุล / ชื่อร้าน / เบอร์ */
  q: z.string().trim().max(100).optional(),
});
export type AdminVendorListQuery = z.infer<typeof adminVendorListQuerySchema>;

export const rejectVendorSchema = z.object({
  reason: z.string().trim().min(3, 'กรุณาระบุเหตุผล (อย่างน้อย 3 ตัวอักษร)').max(500),
});
export type RejectVendorInput = z.infer<typeof rejectVendorSchema>;

export const suspendVendorSchema = z.object({
  /** ISO datetime — ต้องเป็นอนาคต */
  until: z.iso.datetime({ offset: true }),
  reason: z.string().trim().max(500).optional(),
});
export type SuspendVendorInput = z.infer<typeof suspendVendorSchema>;

/** ระบุ `ids` หรือ `allPending: true` (ปุ่ม "อนุมัติทั้งหมดที่ค้าง" — §9.2 ข้อ 4) อย่างใดอย่างหนึ่ง */
export const bulkApproveVendorsSchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(100).optional(),
    allPending: z.literal(true).optional(),
  })
  .strict()
  .refine((v) => (v.ids === undefined) !== (v.allPending === undefined), {
    message: 'ระบุ ids หรือ allPending อย่างใดอย่างหนึ่ง',
  });
export type BulkApproveVendorsInput = z.infer<typeof bulkApproveVendorsSchema>;

export interface AdminVendorListItem {
  id: string;
  firstName: string;
  lastName: string;
  shopName: string | null;
  phone: string;
  status: VendorStatus;
  productCategoryName: string | null;
  createdAt: string;
  reviewedAt: string | null;
  /** ลบข้อมูลส่วนบุคคลแล้ว (PDPA) */
  deletedAt: string | null;
}

export interface AdminVendorDetail extends VendorProfile {
  reviewedBy: { id: string; displayName: string } | null;
  reviewedAt: string | null;
  noshowCount: number;
  pdpaConsentAt: string;
  /** ลบข้อมูลส่วนบุคคลแล้ว (PDPA) — ชื่อ/เบอร์เป็นค่าแทน */
  deletedAt: string | null;
}

export type VendorStatusCounts = Record<VendorStatus, number>;

export interface BulkApproveResult {
  approved: string[];
  /** id ที่ข้าม: ไม่พบ หรือไม่ได้อยู่สถานะ PENDING แล้ว */
  skipped: { id: string; reason: 'NOT_FOUND' | 'NOT_PENDING' }[];
}

/** ชื่อสถานะผู้ค้าภาษาไทย — หน้า admin และไฟล์ export */
export const VENDOR_STATUS_TH: Record<VendorStatus, string> = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  SUSPENDED: 'ระงับ',
};
