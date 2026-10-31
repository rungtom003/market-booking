import type { VendorAuthResult } from '@market-booking/shared';

/**
 * ผลจาก OTP/LINE ที่ยังไม่มีบัญชี — เก็บใน sessionStorage ให้รีเฟรชหน้าสมัครแล้วไม่หาย
 * (หายเมื่อปิดแท็บ; token หมดอายุเองใน 30 นาที)
 */
export type RegistrationDraft = Extract<VendorAuthResult, { status: 'REGISTRATION_REQUIRED' }> & {
  savedAt: number;
};

const KEY = 'mb.registration';

export const registrationDraft = {
  save(result: Extract<VendorAuthResult, { status: 'REGISTRATION_REQUIRED' }>) {
    sessionStorage.setItem(KEY, JSON.stringify({ ...result, savedAt: Date.now() }));
  },
  load(): RegistrationDraft | null {
    try {
      const draft = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as RegistrationDraft | null;
      if (!draft || Date.now() - draft.savedAt > draft.expiresIn * 1000) return null;
      return draft;
    } catch {
      return null;
    }
  },
  clear() {
    sessionStorage.removeItem(KEY);
  },
};
