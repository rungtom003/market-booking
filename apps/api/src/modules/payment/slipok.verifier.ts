import { Injectable, Logger } from '@nestjs/common';
import { SlipCheck } from '@market-booking/shared';
import { AppConfigService } from '../../config/app-config.service';
import type { SlipVerification, SlipVerificationInput, SlipVerifier } from './slip-verifier';

export const SLIPOK_URL = 'https://api.slipok.com/api/line/apikey';
const TIMEOUT_MS = 15_000;

/** ผลสำเร็จของ SlipOK (เฉพาะ field ที่ใช้) — https://slipok.com/api-documentation/check-slip/ */
interface SlipOkSlip {
  success?: boolean;
  transRef?: string;
  amount?: number | string;
}

interface SlipOkResponse {
  success?: boolean;
  data?: SlipOkSlip;
  /** error: code + message (บาง code มี data) */
  code?: number;
  message?: string;
}

/** code ของ SlipOK → ผลของเรา (https://slipok.com/api-documentation/error-status-code/) */
function fromErrorCode(code: number | undefined): SlipVerification {
  switch (code) {
    case 1012:
      return { status: 'INVALID', reason: 'สลิปนี้เคยใช้ชำระแล้ว', check: SlipCheck.DUPLICATE };
    case 1013:
      return {
        status: 'INVALID',
        reason: 'ยอดเงินบนสลิปไม่ตรงกับยอดที่ต้องชำระ',
        check: SlipCheck.AMOUNT_MISMATCH,
      };
    case 1014:
      return {
        status: 'INVALID',
        reason: 'โอนเข้าบัญชีที่ไม่ใช่ของตลาด',
        check: SlipCheck.RECEIVER_MISMATCH,
      };
    case 1011:
      return {
        status: 'INVALID',
        reason: 'ไม่พบรายการโอนนี้ในระบบธนาคาร (QR หมดอายุหรือไม่มีรายการจริง)',
        check: SlipCheck.NOT_FOUND,
      };
    // รูป/QR มีปัญหา — คนดูอาจอ่านได้ (เช่น ถ่ายเอียง) ไม่ปฏิเสธเอง
    case 1005:
    case 1006:
    case 1007:
    case 1008:
      return { status: 'UNVERIFIED', check: SlipCheck.UNREADABLE };
    case 1010:
      return { status: 'UNVERIFIED', check: SlipCheck.BANK_DELAY };
    // 1000–1004 (ตั้งค่า/แพ็กเกจ/โควตา), 1009 (ธนาคารขัดข้อง), อื่นๆ
    default:
      return { status: 'UNVERIFIED', check: SlipCheck.ERROR };
  }
}

/**
 * SlipOK (Phase 11.2): ส่งรูปสลิป (`files`) พร้อม `log: true` (SlipOK ตรวจบัญชีปลายทางที่ผูกใน LIFF + สลิปซ้ำ)
 * และ `amount` — ตรวจยอดซ้ำฝั่งเราอีกชั้น; ขัดข้อง/timeout = UNVERIFIED (เจ้าหน้าที่ตรวจ ไม่ทำให้การส่งสลิปล้ม)
 */
@Injectable()
export class SlipOkVerifier implements SlipVerifier {
  private readonly logger = new Logger(SlipOkVerifier.name);

  constructor(private readonly config: AppConfigService) {}

  async verify(input: SlipVerificationInput): Promise<SlipVerification> {
    const form = new FormData();
    const ext = input.contentType.split('/')[1] ?? 'jpg';
    form.append('files', new Blob([input.image], { type: input.contentType }), `slip.${ext}`);
    form.append('log', 'true');
    form.append('amount', String(input.amount));

    let res: Response;
    try {
      res = await fetch(`${SLIPOK_URL}/${this.config.get('SLIPOK_BRANCH_ID')}`, {
        method: 'POST',
        headers: { 'x-authorization': this.config.get('SLIPOK_API_KEY') ?? '' },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`SlipOK request failed (${input.paymentId}): ${String(error)}`);
      return { status: 'UNVERIFIED', check: SlipCheck.ERROR };
    }
    const body = (await res.json().catch(() => ({}))) as SlipOkResponse;

    if (!res.ok || !body.success || !body.data?.success) {
      const result = fromErrorCode(body.code);
      if (result.status === 'UNVERIFIED') {
        // ไม่ log ข้อความเต็ม — อาจมีชื่อผู้โอน
        this.logger.warn(`SlipOK HTTP ${res.status} code ${body.code ?? '-'} (${input.paymentId})`);
      }
      return result;
    }
    if (Number(body.data.amount) !== input.amount) return fromErrorCode(1013);
    return { status: 'VALID', transRef: body.data.transRef };
  }
}
