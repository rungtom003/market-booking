import { z } from 'zod';
import type { RoundPhase, RoundStatus } from './enums.js';

// ───────────── ประเภทสินค้า ─────────────

const sortOrderSchema = z.number().int().min(0).max(10_000);

export const createProductCategorySchema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อประเภทสินค้า').max(100),
  sortOrder: sortOrderSchema.optional(),
});
export type CreateProductCategoryInput = z.infer<typeof createProductCategorySchema>;

export const updateProductCategorySchema = createProductCategorySchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'ไม่มีข้อมูลที่เปลี่ยนแปลง');
export type UpdateProductCategoryInput = z.infer<typeof updateProductCategorySchema>;

export interface ProductCategory {
  id: string;
  name: string;
  sortOrder: number;
  /** จำนวนผู้ค้าที่เลือกประเภทนี้ — มากกว่า 0 ลบไม่ได้ */
  vendorCount: number;
}

// ───────────── โซน ─────────────

export const zoneFields = {
  name: z.string().trim().min(1, 'กรุณากรอกชื่อโซน').max(100),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'สีต้องอยู่ในรูปแบบ #RRGGBB')
    .transform((v) => v.toUpperCase()),
  /** ว่าง = ขายได้ทุกประเภท */
  allowedCategoryIds: z
    .array(z.uuid())
    .max(100)
    .transform((ids) => [...new Set(ids)]),
  sortOrder: sortOrderSchema,
};

export const createZoneSchema = z.object({
  ...zoneFields,
  allowedCategoryIds: zoneFields.allowedCategoryIds.default([]),
  sortOrder: sortOrderSchema.optional(),
});
export type CreateZoneInput = z.infer<typeof createZoneSchema>;

export const updateZoneSchema = z
  .object(zoneFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'ไม่มีข้อมูลที่เปลี่ยนแปลง');
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>;

export interface Zone {
  id: string;
  name: string;
  color: string;
  allowedCategoryIds: string[];
  sortOrder: number;
  /** จำนวนล็อคในโซน — มากกว่า 0 ลบไม่ได้ */
  stallCount: number;
}

// ───────────── ล็อค ─────────────

/** รหัสล็อค เช่น `A12` — ไม่มีช่องว่าง, ตัวอักษรอังกฤษเป็นตัวใหญ่ (unique ต่อตลาด) */
export const stallCodeSchema = z
  .string()
  .trim()
  .min(1, 'กรุณากรอกรหัสล็อค')
  .max(20, 'รหัสล็อคยาวได้ไม่เกิน 20 ตัวอักษร')
  .regex(/^\S+$/, 'รหัสล็อคต้องไม่มีช่องว่าง')
  .transform((v) => v.toUpperCase());

/** ขนาดจริง (เมตร) — decimal(5,2) */
const metersSchema = z
  .number({ error: 'กรุณากรอกตัวเลข' })
  .min(0.1, 'ต้องมากกว่า 0')
  .max(999, 'มากเกินไป');
export const priceSchema = z
  .number({ error: 'กรุณากรอกตัวเลข' })
  .min(0, 'ราคาต้องไม่ติดลบ')
  .max(1_000_000, 'ราคาสูงเกินไป');
/** ตำแหน่ง/ขนาดบนผัง (px ของ canvas) */
const canvasPosSchema = z.number({ error: 'กรุณากรอกตัวเลข' }).min(0).max(100_000);
const canvasSizeSchema = z.number({ error: 'กรุณากรอกตัวเลข' }).min(1).max(10_000);

export const stallFields = {
  zoneId: z.uuid('กรุณาเลือกโซน'),
  code: stallCodeSchema,
  widthM: metersSchema,
  lengthM: metersSchema,
  price: priceSchema,
  posX: canvasPosSchema,
  posY: canvasPosSchema,
  /** องศา */
  rot: z.number().min(-360).max(360),
  shapeW: canvasSizeSchema,
  shapeH: canvasSizeSchema,
  isActive: z.boolean(),
  isReserved: z.boolean(),
  note: z.string().trim().max(500).nullish(),
};

export const createStallSchema = z.object({
  ...stallFields,
  posX: canvasPosSchema.default(0),
  posY: canvasPosSchema.default(0),
  rot: stallFields.rot.default(0),
  shapeW: canvasSizeSchema.default(60),
  shapeH: canvasSizeSchema.default(60),
  isActive: z.boolean().default(true),
  isReserved: z.boolean().default(false),
});
export type CreateStallInput = z.infer<typeof createStallSchema>;

export const updateStallSchema = z
  .object(stallFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'ไม่มีข้อมูลที่เปลี่ยนแปลง');
export type UpdateStallInput = z.infer<typeof updateStallSchema>;

/** สร้างได้ครั้งละไม่เกินนี้ */
export const MAX_BULK_STALLS = 200;

/**
 * สร้างล็อคทีละหลายรายการ: `prefix` + เลข `from`–`to` เช่น A1–A20 (ขนาด/ราคาเดียวกัน)
 * วางบนผังเป็นตาราง `columns` คอลัมน์ — ไม่ระบุ `originY` = วางต่อใต้ล็อคที่มีอยู่
 */
export const bulkCreateStallsSchema = z
  .object({
    zoneId: stallFields.zoneId,
    /** prefix ≤ 10 + เลข ≤ 5 หลัก → รหัสไม่เกิน 20 ตัวอักษรเสมอ */
    prefix: z
      .string()
      .trim()
      .max(10)
      .regex(/^\S*$/, 'คำนำหน้าต้องไม่มีช่องว่าง')
      .transform((v) => v.toUpperCase()),
    from: z.number().int().min(0).max(99_999),
    to: z.number().int().min(0).max(99_999),
    /** เติม 0 ข้างหน้าให้ครบกี่หลัก เช่น 2 → A01 (0 = ไม่เติม) */
    padLength: z.number().int().min(0).max(5).default(0),
    widthM: metersSchema,
    lengthM: metersSchema,
    price: priceSchema,
    shapeW: canvasSizeSchema.default(60),
    shapeH: canvasSizeSchema.default(60),
    columns: z.number().int().min(1).max(100).default(10),
    gap: z.number().min(0).max(1_000).default(10),
    originX: canvasPosSchema.default(20),
    originY: canvasPosSchema.optional(),
  })
  .refine((v) => v.to >= v.from, { path: ['to'], message: 'เลขสิ้นสุดต้องไม่น้อยกว่าเลขเริ่มต้น' })
  .refine((v) => v.to - v.from + 1 <= MAX_BULK_STALLS, {
    path: ['to'],
    message: `สร้างได้ครั้งละไม่เกิน ${MAX_BULK_STALLS} ล็อค`,
  });
export type BulkCreateStallsInput = z.infer<typeof bulkCreateStallsSchema>;

/** รหัสที่ bulk create จะสร้าง — ใช้ทั้ง API และตัวอย่างใน dialog */
export function bulkStallCodes(
  input: Pick<BulkCreateStallsInput, 'prefix' | 'from' | 'to' | 'padLength'>,
): string[] {
  return Array.from(
    { length: Math.max(0, input.to - input.from + 1) },
    (_, i) => `${input.prefix}${String(input.from + i).padStart(input.padLength, '0')}`,
  );
}

export interface BulkCreateStallsResult {
  created: number;
  codes: string[];
}

export const adminStallListQuerySchema = z.object({
  zoneId: z.uuid().optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type AdminStallListQuery = z.infer<typeof adminStallListQuerySchema>;

export interface Stall {
  id: string;
  zoneId: string;
  code: string;
  widthM: number;
  lengthM: number;
  price: number;
  posX: number;
  posY: number;
  rot: number;
  shapeW: number;
  shapeH: number;
  isActive: boolean;
  isReserved: boolean;
  note: string | null;
  /** มีประวัติการจอง — ลบไม่ได้ ให้ปิดการใช้งาน (is_active = false) แทน */
  hasBookings: boolean;
}

// ───────────── ผังตลาด (StallMap) ─────────────

export interface MapZone {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface MapStall {
  id: string;
  zoneId: string;
  code: string;
  widthM: number;
  lengthM: number;
  price: number;
  posX: number;
  posY: number;
  rot: number;
  shapeW: number;
  shapeH: number;
}

/** ผังของตลาด (เฉพาะล็อคที่เปิดใช้งาน) — `GET /market/layout` */
export interface MarketLayout {
  zones: MapZone[];
  stalls: (MapStall & { isReserved: boolean })[];
}

/**
 * สถานะของล็อคในวันขาย (ชื่อเดียวกับ `stall:updated.state` — Overview §10.2)
 * HOLD = มีคนกดจองค้างไว้, BOOKED = รอชำระ/รอตรวจสลิป/ยืนยันแล้ว,
 * CLOSED = สงวนไว้ / ปิดเฉพาะวัน / วันขายถูกยกเลิก
 */
export const StallDayStatus = {
  AVAILABLE: 'AVAILABLE',
  HOLD: 'HOLD',
  BOOKED: 'BOOKED',
  CLOSED: 'CLOSED',
} as const;
export type StallDayStatus = (typeof StallDayStatus)[keyof typeof StallDayStatus];

export interface MarketDayStall extends MapStall {
  status: StallDayStatus;
  /** การจองนี้เป็นของผู้ค้าที่ดูอยู่ */
  mine: boolean;
  /** id การจอง — ส่งเฉพาะของตัวเอง (ไม่เปิดเผยข้อมูลผู้ค้าคนอื่น) */
  bookingId: string | null;
}

/** `GET /market-days/:id/stalls` — ราคาเป็นราคาของวันนั้น (รวม override) */
export interface MarketDayStalls {
  marketDay: { id: string; roundId: string; marketDate: string; isCancelled: boolean };
  /** รอบของวันขายนี้ — `phase` คำนวณจากเวลา server ตอนตอบ (null = ยังไม่เผยแพร่/ยกเลิก) */
  round: {
    id: string;
    name: string;
    status: RoundStatus;
    phase: RoundPhase | null;
    openAt: string;
    closeAt: string;
    maxStallsPerVendor: number;
  };
  /** เวลา server ตอนตอบ — หา offset ให้ Countdown */
  serverTime: string;
  zones: MapZone[];
  stalls: MarketDayStall[];
}
