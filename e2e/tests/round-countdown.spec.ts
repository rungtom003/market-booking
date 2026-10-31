import { expect, test } from '@playwright/test';
import {
  adminRequest,
  bangkokDate,
  expectNoHorizontalScroll,
  parseCountdown,
  randomPhone,
  registerVendor,
} from '../helpers';

test.describe('ผู้ค้าเห็นรอบที่กำลังจะเปิด (จอ 360px)', () => {
  let roundId: string | null = null;
  let cleanup: (() => Promise<void>) | null = null;

  test.afterEach(async () => {
    await cleanup?.();
  });

  test('Countdown ตรงกับเวลา server แม้นาฬิกาเครื่องเร็วไป 3 ชั่วโมง และเปลี่ยนเป็น "เปิดจองแล้ว" เมื่อถึงเวลา', async ({
    page,
    request,
  }) => {
    const phone = randomPhone();
    await registerVendor(page, phone, { firstName: 'นับถอย', lastName: 'หลัง' });
    const admin = await adminRequest(request);
    await admin.approve(phone);

    // E2E รัน API บนเครื่องเดียวกัน — Date.now() ของ Node = เวลา server
    const openAt = new Date(Date.now() + 20_000);
    roundId = await admin.publishRound({
      name: `รอบทดสอบนับถอยหลัง ${Date.now() % 100_000}`,
      openAt,
      closeAt: new Date(openAt.getTime() + 86_400_000),
      dates: [bangkokDate(3), bangkokDate(4)],
    });
    const id = roundId;
    cleanup = () => admin.cancelRound(id);

    await page.clock.install({ time: new Date(Date.now() + 3 * 3_600_000) });
    await page.reload();

    const timer = page.getByRole('timer', { name: 'เวลาที่เหลือก่อนเปิดจอง' });
    await expect(timer).toBeVisible();
    await expect(page.getByText('กำลังจะเปิดจอง')).toBeVisible();
    await expectNoHorizontalScroll(page);

    // อ่านหลายครั้ง: ค่าที่แสดงต้องคลาดจากเวลา server ไม่เกิน 1 วินาที (ไม่ใช่ 3 ชั่วโมง)
    for (let i = 0; i < 3; i++) {
      const shown = parseCountdown((await timer.textContent()) ?? '');
      const expected = (openAt.getTime() - Date.now()) / 1000;
      expect(Math.abs(shown - expected)).toBeLessThanOrEqual(1);
      await page.waitForTimeout(1_100);
    }

    // ถึง open_at → ถาม server แล้วเปลี่ยนเป็นนับถอยหลังปิดจอง
    await expect(page.getByText('เปิดจองแล้ว', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('timer', { name: 'เวลาที่เหลือก่อนปิดจอง' })).toHaveText(
      /^(1 วัน 00:00:00|23:59:\d{2})$/,
    );
  });
});
