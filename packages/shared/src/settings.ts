import { RegistrationMode } from './enums.js';

/**
 * ค่าเริ่มต้นของ system_settings (Overview §12) — seed ใช้ค่าชุดนี้
 * Zod schema สำหรับ validate ตอนแก้ค่าจะเพิ่มใน Phase 1.5
 */
export const SETTING_DEFAULTS = {
  registration_mode: RegistrationMode.MANUAL as RegistrationMode,
  require_id_card_image: false,
  require_shop_image: false,
  hold_minutes: 10,
  payment_required: true,
  payment_deadline_minutes: 1440,
  /** เบอร์/เลขผู้เสียภาษีสำหรับสร้าง PromptPay QR — ไม่มีค่าเริ่มต้น */
  promptpay_id: null as string | null,
  max_stalls_per_vendor_default: 1,
  cancel_before_hours: 48,
  waitlist_claim_minutes: 30,
  noshow_threshold: 3,
  noshow_suspend_days: 30,
  notify_before_round_open_minutes: 60,
};

export type Settings = typeof SETTING_DEFAULTS;
export type SettingKey = keyof Settings;
