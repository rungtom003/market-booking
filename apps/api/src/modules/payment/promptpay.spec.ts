import {
  crc16ccitt,
  promptPayPayload,
  rejectPaymentSchema,
  slipUploadRequestSchema,
} from '@market-booking/shared';

/** แยก payload EMVCo (TLV) เป็น map ของ id → ค่า (ชั้นบนสุด) */
function parseTlv(payload: string): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < payload.length;) {
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    out.set(id, payload.slice(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return out;
}

describe('PromptPay payload (EMVCo)', () => {
  it('CRC-16/CCITT-FALSE: ค่าตรวจสอบมาตรฐานของ "123456789" = 29B1', () => {
    expect(crc16ccitt('123456789')).toBe('29B1');
    expect(crc16ccitt('')).toBe('FFFF');
  });

  it('เบอร์มือถือ + ยอดเงิน → QR แบบใช้ครั้งเดียว, ปลายทาง 0066 + เบอร์ไม่มี 0', () => {
    const payload = promptPayPayload('0812345678', 150);
    const tlv = parseTlv(payload);
    expect(tlv.get('00')).toBe('01');
    expect(tlv.get('01')).toBe('12');
    expect(tlv.get('58')).toBe('TH');
    expect(tlv.get('53')).toBe('764');
    expect(tlv.get('54')).toBe('150.00');
    const merchant = parseTlv(tlv.get('29')!);
    expect(merchant.get('00')).toBe('A000000677010111');
    expect(merchant.get('01')).toBe('0066812345678');
    // CRC คำนวณจากทุกอย่างก่อนหน้ารวม "6304"
    expect(payload.slice(-8, -4)).toBe('6304');
    expect(payload.slice(-4)).toBe(crc16ccitt(payload.slice(0, -4)));
  });

  it('เลขผู้เสียภาษี 13 หลัก / e-Wallet 15 หลัก ใช้ field 02 / 03', () => {
    expect(parseTlv(parseTlv(promptPayPayload('1234567890123', 1)).get('29')!).get('02')).toBe(
      '1234567890123',
    );
    expect(parseTlv(parseTlv(promptPayPayload('123456789012345')).get('29')!).get('03')).toBe(
      '123456789012345',
    );
  });

  it('ไม่ระบุยอด → QR แบบคงที่ (11) และไม่มี field 54; ทศนิยม 2 ตำแหน่ง', () => {
    const tlv = parseTlv(promptPayPayload('081-234-5678'));
    expect(tlv.get('01')).toBe('11');
    expect(tlv.has('54')).toBe(false);
    expect(parseTlv(promptPayPayload('0812345678', 99.5)).get('54')).toBe('99.50');
  });
});

describe('payment schemas', () => {
  it('สลิปต้องเป็นรูปที่รองรับและไม่เกิน 5 MB', () => {
    expect(slipUploadRequestSchema.safeParse({ contentType: 'image/png', size: 100 }).success).toBe(
      true,
    );
    expect(
      slipUploadRequestSchema.safeParse({ contentType: 'application/pdf', size: 100 }).success,
    ).toBe(false);
    expect(
      slipUploadRequestSchema.safeParse({ contentType: 'image/png', size: 6 * 1024 * 1024 })
        .success,
    ).toBe(false);
  });

  it('ไม่ผ่านต้องมีเหตุผลอย่างน้อย 3 ตัวอักษร', () => {
    expect(rejectPaymentSchema.safeParse({ reason: 'ab' }).success).toBe(false);
    expect(rejectPaymentSchema.parse({ reason: ' ยอดไม่ตรง ' })).toEqual({ reason: 'ยอดไม่ตรง' });
  });
});
