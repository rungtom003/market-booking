import { type NotificationTemplate, renderTemplate } from './templates';

const ctx = { webOrigin: 'https://market.test', adminOrigin: 'https://admin.market.test' };
const BOOKING = '0193a5e0-0000-7000-8000-000000000001';

/** ทุก template อย่างน้อย 1 ตัวอย่าง — เพิ่ม template ใหม่แล้วต้องเพิ่มที่นี่ (TypeScript บังคับครบผ่าน satisfies) */
const samples = {
  'vendor.approved': { template: 'vendor.approved', params: {} },
  'vendor.rejected': { template: 'vendor.rejected', params: { reason: 'รูปบัตรไม่ชัด' } },
  'vendor.suspended': {
    template: 'vendor.suspended',
    params: { reason: 'ไม่มาขาย', until: '2026-12-01T10:00:00.000Z' },
  },
  'round.opening_soon': {
    template: 'round.opening_soon',
    params: { roundName: 'รอบธันวาคม', openAt: '2026-11-20T03:00:00.000Z' },
  },
  'booking.confirmed': {
    template: 'booking.confirmed',
    params: { stallCode: 'A1', marketDate: '2026-11-21' },
  },
  'payment.due_soon': {
    template: 'payment.due_soon',
    params: {
      bookingId: BOOKING,
      stallCode: 'A1',
      marketDate: '2026-11-21',
      amount: 1500,
      dueAt: '2026-11-20T05:30:00.000Z',
    },
  },
  'payment.rejected': {
    template: 'payment.rejected',
    params: {
      bookingId: BOOKING,
      stallCode: 'A1',
      reason: 'ยอดไม่ตรง',
      dueAt: '2026-11-20T05:30:00.000Z',
    },
  },
  'booking.cancelled': {
    template: 'booking.cancelled',
    params: { stallCode: 'A1', marketDate: '2026-11-21', reason: 'จัดเวที' },
  },
  'admin.vendor_registered': {
    template: 'admin.vendor_registered',
    params: { vendorName: 'สมชาย ใจดี' },
  },
  'admin.payment_submitted': {
    template: 'admin.payment_submitted',
    params: { vendorName: 'สมชาย ใจดี', stallCode: 'A1', marketDate: '2026-11-21', amount: 150 },
  },
} satisfies {
  [K in NotificationTemplate['template']]: Extract<NotificationTemplate, { template: K }>;
};

describe('notification templates', () => {
  it.each(Object.values(samples))('$template มีหัวข้อ, SMS และลิงก์ไปหน้าที่เกี่ยวข้อง', (n) => {
    const m = renderTemplate(n, ctx);

    expect(m.title.length).toBeGreaterThan(0);
    expect(m.sms.length).toBeGreaterThan(0);
    // SMS ภาษาไทย 67 ตัวอักษรต่อส่วน — ไม่เกิน 3 ส่วน (ไม่รวมลิงก์)
    expect(m.sms.replace(/https?:\/\/\S+/g, '').length).toBeLessThanOrEqual(3 * 67);
    expect(m.link?.url).toMatch(/^https:\/\/(admin\.)?market\.test\//);
  });

  it('แสดงเวลาไทยและยอดเงินแบบมีจุลภาค', () => {
    const m = renderTemplate(samples['payment.due_soon'], ctx);

    // 05:30Z = 12:30 น. เวลาไทย
    expect(m.lines).toContain('ยอด 1,500 บาท');
    expect(m.lines.join(' ')).toMatch(/12:30 น\./);
    expect(m.link).toEqual({
      label: 'ชำระเงิน',
      url: `https://market.test/bookings/${BOOKING}/pay`,
    });
    expect(m.sms).toContain(`https://market.test/bookings/${BOOKING}/pay`);
  });

  it('ใส่เหตุผลเมื่อมี และไม่ใส่บรรทัดว่างเมื่อไม่มี', () => {
    expect(renderTemplate(samples['vendor.rejected'], ctx).lines).toContain(
      'เหตุผล: รูปบัตรไม่ชัด',
    );
    const noReason = renderTemplate({ template: 'vendor.rejected', params: { reason: null } }, ctx);
    expect(noReason.lines.some((l) => l.startsWith('เหตุผล'))).toBe(false);
  });

  it('ข้อความของเจ้าหน้าที่ลิงก์ไปแอป admin', () => {
    expect(renderTemplate(samples['admin.payment_submitted'], ctx).link?.url).toBe(
      'https://admin.market.test/payments',
    );
  });
});
