import { Injectable } from '@nestjs/common';

/** ผลตรวจสลิปอัตโนมัติ — UNVERIFIED = ให้เจ้าหน้าที่ตรวจเอง */
export type SlipVerification =
  { status: 'UNVERIFIED' } | { status: 'VALID' } | { status: 'INVALID'; reason: string };

export interface SlipVerificationInput {
  paymentId: string;
  /** object key ของรูปสลิปใน storage */
  slipImageKey: string;
  amount: number;
  /** ปลายทางที่ควรได้รับเงิน (`promptpay_id` ของตลาด) — null = ยังไม่ได้ตั้ง */
  promptpayId: string | null;
}

/**
 * ตรวจสลิปอัตโนมัติ (เช่น บริการอ่าน QR บนสลิปของธนาคาร) — ทำ implementation จริงภายหลัง
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
