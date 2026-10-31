/**
 * PromptPay QR payload ตามมาตรฐาน EMVCo Merchant-Presented QR (Thai QR Payment / ธปท.)
 * ใช้ทั้ง API (ส่งให้ผู้ค้า) และหน้าเว็บ (วาด QR) — โครงสร้างตาม library `promptpay-qr` (เขียนเองไม่พึ่ง dependency)
 *
 * โครงสร้าง: TLV (id 2 หลัก + ความยาว 2 หลัก + ค่า) ปิดท้ายด้วย CRC-16/CCITT-FALSE (id 63)
 */

const GUID_PROMPTPAY = 'A000000677010111';

/** แบบของปลายทางตามจำนวนหลัก (ตรงกับ `promptpay_id` ใน Settings: 10 / 13 / 15 หลัก) */
const TARGET_FIELD = { PHONE: '01', TAX_ID: '02', EWALLET: '03' } as const;

function field(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, เริ่ม 0xFFFF) — ค่าตรวจสอบมาตรฐานของ "123456789" คือ 29B1 */
export function crc16ccitt(text: string): string {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * payload ของ QR พร้อมเพย์
 * @param promptpayId เบอร์มือถือ 10 หลัก / เลขผู้เสียภาษี 13 หลัก / e-Wallet 15 หลัก (ตัวเลขล้วน)
 * @param amount ยอดเงิน (บาท) — ไม่ระบุ = QR แบบให้ผู้จ่ายกรอกยอดเอง
 */
export function promptPayPayload(promptpayId: string, amount?: number): string {
  const digits = promptpayId.replace(/\D/g, '');
  let target: string;
  let targetField: string;
  if (digits.length >= 15) {
    targetField = TARGET_FIELD.EWALLET;
    target = digits;
  } else if (digits.length >= 13) {
    targetField = TARGET_FIELD.TAX_ID;
    target = digits;
  } else {
    // เบอร์มือถือ: 0812345678 → 0066812345678 (รหัสประเทศ 66 เติม 0 ให้ครบ 13 หลัก)
    targetField = TARGET_FIELD.PHONE;
    target = `0000000000000${digits.replace(/^0/, '66')}`.slice(-13);
  }

  const parts = [
    field('00', '01'), // payload format
    field('01', amount === undefined ? '11' : '12'), // QR แบบคงที่ / ใช้ครั้งเดียว (มียอด)
    field('29', field('00', GUID_PROMPTPAY) + field(targetField, target)),
    field('58', 'TH'),
    field('53', '764'), // THB
    ...(amount === undefined ? [] : [field('54', amount.toFixed(2))]),
  ];
  const withoutCrc = `${parts.join('')}6304`;
  return `${withoutCrc}${crc16ccitt(withoutCrc)}`;
}
