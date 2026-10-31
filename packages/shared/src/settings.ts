import { z } from 'zod';
import { RegistrationMode } from './enums.js';

const int = (min: number, max: number) => z.number().int().min(min).max(max);

/**
 * PromptPay: เบอร์มือถือ (10 หลัก), เลขบัตรประชาชน/ผู้เสียภาษี (13 หลัก) หรือ e-Wallet (15 หลัก)
 * รับแบบมีขีด/ช่องว่าง แล้วเก็บเป็นตัวเลขล้วน
 */
export const promptPayIdSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^(\d{10}|\d{13}|\d{15})$/, 'PromptPay ID must be 10, 13 or 15 digits'));

/**
 * schema ของทุก setting (Overview §12) — API ใช้ validate ตอนแก้/อ่านจาก DB,
 * หน้า admin ใช้สร้างฟอร์มและ validate ฝั่ง client
 */
export const settingFields = {
  /** อนุมัติสมาชิกอัตโนมัติหรือตรวจก่อน */
  registration_mode: z.enum([RegistrationMode.AUTO, RegistrationMode.MANUAL]),
  require_id_card_image: z.boolean(),
  require_shop_image: z.boolean(),
  /** เวลา Hold ก่อนกดยืนยัน (นาที) */
  hold_minutes: int(1, 60),
  payment_required: z.boolean(),
  /** เวลาชำระหลังยืนยัน (นาที, สูงสุด 7 วัน) */
  payment_deadline_minutes: int(5, 7 * 24 * 60),
  /** null = ยังไม่ตั้ง (สร้าง QR ไม่ได้) */
  promptpay_id: promptPayIdSchema.nullable(),
  max_stalls_per_vendor_default: int(1, 50),
  /** ยกเลิกเองได้ถ้าเหลือเวลาก่อนวันขาย ≥ ค่านี้ (ชั่วโมง) */
  cancel_before_hours: int(0, 30 * 24),
  waitlist_claim_minutes: int(1, 24 * 60),
  noshow_threshold: int(1, 20),
  noshow_suspend_days: int(1, 365),
  /** 0 = ไม่แจ้งเตือนก่อนรอบเปิด */
  notify_before_round_open_minutes: int(0, 7 * 24 * 60),
};

export const settingsSchema = z.object(settingFields);
export type Settings = z.output<typeof settingsSchema>;
export type SettingKey = keyof Settings;

/** ค่าเริ่มต้น (Overview §12) — seed ใช้ชุดนี้, key ที่ยังไม่มีใน DB ใช้ค่านี้ */
export const SETTING_DEFAULTS: Settings = {
  registration_mode: RegistrationMode.MANUAL,
  require_id_card_image: false,
  require_shop_image: false,
  hold_minutes: 10,
  payment_required: true,
  payment_deadline_minutes: 1440,
  promptpay_id: null,
  max_stalls_per_vendor_default: 1,
  cancel_before_hours: 48,
  waitlist_claim_minutes: 30,
  noshow_threshold: 3,
  noshow_suspend_days: 30,
  notify_before_round_open_minutes: 60,
};

export const SETTING_KEYS = Object.keys(settingFields) as SettingKey[];

/** body ของ PUT /admin/settings — ส่งเฉพาะ key ที่จะแก้; key ที่ไม่รู้จัก → 400 */
export const updateSettingsSchema = settingsSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
