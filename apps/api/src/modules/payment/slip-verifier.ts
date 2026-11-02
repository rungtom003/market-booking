import { Injectable } from '@nestjs/common';
import type { SlipCheck } from '@market-booking/shared';

/**
 * ผลตรวจสลิปอัตโนมัติ — UNVERIFIED = ให้เจ้าหน้าที่ตรวจเอง (`check` บอกเหตุให้เจ้าหน้าที่เห็น)
 * VALID มี `transRef` (เลขอ้างอิงธุรกรรม) — ระบบเก็บแบบ unique กันสลิปเดียวใช้ 2 ครั้ง
 */
export type SlipVerification =
  | { status: 'UNVERIFIED'; check?: SlipCheck }
  | { status: 'VALID'; transRef?: string }
  | { status: 'INVALID'; reason: string; check?: SlipCheck };

export interface SlipVerificationInput {
  paymentId: string;
  /** object key ของรูปสลิปใน storage */
  slipImageKey: string;
  /** รูปสลิป (อ่านจาก storage แล้ว) */
  image: Buffer;
  contentType: string;
  amount: number;
  /** ปลายทางที่ควรได้รับเงิน (`promptpay_id` ของตลาด) — null = ยังไม่ได้ตั้ง */
  promptpayId: string | null;
}

/**
 * ตรวจสลิปอัตโนมัติ (บริการอ่าน QR บนสลิปของธนาคาร) — เลือกด้วย env `SLIP_VERIFIER`
 * VALID → อนุมัติให้เอง, INVALID → ไม่ผ่านพร้อมเหตุผล, UNVERIFIED → รอเจ้าหน้าที่ (§9.5)
 */
export interface SlipVerifier {
  verify(input: SlipVerificationInput): Promise<SlipVerification>;
}

/** inject ด้วย `@Inject(SLIP_VERIFIER)` — test override ด้วย `.overrideProvider(SLIP_VERIFIER)` */
export const SLIP_VERIFIER = Symbol('SLIP_VERIFIER');

/** ค่าเริ่มต้น: ไม่ตรวจอัตโนมัติ — ทุกสลิปรอเจ้าหน้าที่การเงิน */
@Injectable()
export class ManualSlipVerifier implements SlipVerifier {
  async verify(): Promise<SlipVerification> {
    return { status: 'UNVERIFIED' };
  }
}
