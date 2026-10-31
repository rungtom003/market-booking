import { z } from 'zod';
import type { AccessTokenResponse } from './auth.js';
import type { VendorStatus } from './enums.js';

/**
 * เบอร์มือถือไทย — รับ `0812345678`, `081-234-5678`, `+66812345678`, `66812345678`
 * แปลงเป็นรูปแบบเดียว `0XXXXXXXXX` (10 หลัก ขึ้นต้น 06/08/09) ก่อนเก็บ/เทียบ
 */
export const thaiMobilePhoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^(?:\+?66|0)[689]\d{8}$/, 'เบอร์มือถือไม่ถูกต้อง (เช่น 0812345678)'))
  .transform((value) => `0${value.slice(-9)}`);

export const OTP_LENGTH = 6;

export const otpRequestSchema = z.object({ phone: thaiMobilePhoneSchema });
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({
  phone: thaiMobilePhoneSchema,
  code: z.string().regex(/^\d{6}$/, 'รหัส OTP ต้องเป็นตัวเลข 6 หลัก'),
  /** ส่งมาเมื่อมาจากขั้นตอน LINE (ยังไม่มีบัญชี) — ถ้าเบอร์นี้มีบัญชีอยู่แล้วจะผูก LINE ให้ */
  registrationToken: z.string().max(2000).optional(),
});
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

export const lineLoginSchema = z.object({
  /** ID token จาก `liff.getIDToken()` */
  idToken: z.string().min(1).max(4000),
});
export type LineLoginInput = z.infer<typeof lineLoginSchema>;

export interface OtpRequestResponse {
  /** วินาทีก่อน OTP หมดอายุ */
  expiresIn: number;
  /** วินาทีก่อนขอใหม่ได้ */
  resendAfter: number;
}

export interface VendorSummary {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  status: VendorStatus;
  lineLinked: boolean;
}

/** ผลของ OTP verify / LINE login: มีบัญชีแล้ว → login, ยังไม่มี → ไปหน้าสมัครพร้อม registrationToken */
export type VendorAuthResult =
  | ({ status: 'LOGGED_IN'; vendor: VendorSummary } & AccessTokenResponse)
  | {
      status: 'REGISTRATION_REQUIRED';
      registrationToken: string;
      /** วินาที */
      expiresIn: number;
      /** ข้อมูลสำหรับกรอกฟอร์มล่วงหน้า */
      prefill: { phone?: string; displayName?: string };
    };
