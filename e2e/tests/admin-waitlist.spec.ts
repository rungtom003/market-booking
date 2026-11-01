import { type Page, expect, test } from '@playwright/test';
import { ADMIN_URL, E2E_ADMIN, WEB_URL } from '../env';
import { adminRequest, bangkokDate, randomPhone, registerVendor } from '../helpers';

async function adminLogin(page: Page) {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel('ชื่อผู้ใช้').fill(E2E_ADMIN.username);
  await page.getByLabel('รหัสผ่าน').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.getByText(/^สวัสดี/)).toBeVisible();
}

test.describe('คิวรอล็อค (Waitlist)', () => {
  let cleanup: (() => Promise<void>) | null = null;

  test.afterEach(async () => {
    await cleanup?.();
    cleanup = null;
  });

  test('ล็อคเต็ม → เข้าคิว → ล็อคถูกยกเลิก → ได้สิทธิ์ทันที (ไม่รีเฟรช) → ยืนยัน; admin เห็นคิว', async ({
    page,
    browser,
    request,
  }) => {
    const api = await adminRequest(request);
    const ownerPhone = randomPhone();
    const waiterPhone = randomPhone();
    const vendorContext = () =>
      browser.newContext({
        viewport: { width: 360, height: 740 },
        locale: 'th-TH',
        timezoneId: 'Asia/Bangkok',
        baseURL: WEB_URL,
      });
    const ownerCtx = await vendorContext();
    await registerVendor(await ownerCtx.newPage(), ownerPhone, {
      firstName: 'เจ้าของ',
      lastName: 'เดิม',
    });
    await ownerCtx.close();
    const waiter = await (await vendorContext()).newPage();
    await registerVendor(waiter, waiterPhone, { firstName: 'รอ', lastName: 'คิวแรก' });
    await api.approve(ownerPhone);
    await api.approve(waiterPhone);

    const { roundId, dayIds } = await api.publishRound({
      name: `รอบคิวรอ E2E ${Date.now() % 100_000}`,
      openAt: new Date(Date.now() - 60_000),
      closeAt: new Date(Date.now() + 86_400_000),
      dates: [bangkokDate(110)],
      maxStallsPerVendor: 1,
    });
    cleanup = () => api.cancelRound(roundId);
    const dayId = dayIds[0]!;
    const ownerBooking = await api.bookForVendor({
      marketDayId: dayId,
      stallCode: 'B3',
      vendorId: await api.vendorId(ownerPhone),
    });

    // ผู้ค้าเห็น B3 จองแล้ว → เข้าคิว
    await waiter.goto(`/days/${dayId}`);
    await waiter.locator('[data-stall-code="B3"]').click();
    const sheet = waiter.getByRole('region', { name: 'ล็อค B3' });
    await expect(sheet.getByText('จองแล้ว')).toBeVisible();
    await sheet.getByRole('button', { name: 'เข้าคิวรอล็อคนี้' }).click();
    await expect(sheet.getByText('อยู่ในคิวล็อคนี้ · คิวแรก')).toBeVisible();

    // admin เห็นคิวของวันขาย
    await adminLogin(page);
    await page.goto(`${ADMIN_URL}/bookings?day=${dayId}`);
    const queue = page.getByRole('table', { name: 'คิวรอ' });
    await expect(queue.getByRole('row').filter({ hasText: 'รอ คิวแรก' })).toContainText('ล็อค B3');
    await expect(page.getByRole('heading', { name: 'คิวรอ (1)' })).toBeVisible();

    // ล็อคว่าง → ผู้ค้าในคิวได้ HOLD ทันที (แถบยืนยันขึ้นเองไม่ต้องรีเฟรช)
    await api.cancelBooking(ownerBooking, 'ผู้ค้าแจ้งไม่มาขาย');
    await expect(waiter.getByText('ได้สิทธิ์ล็อค B3 จากคิวรอ — กดยืนยันก่อนหมดเวลา')).toBeVisible();
    const holdBar = waiter.getByRole('region', { name: 'ยืนยันการจอง' });
    await expect(holdBar).toContainText('B3');
    await holdBar.getByRole('button', { name: 'ยืนยันการจอง' }).click();
    await expect(waiter).toHaveURL(/\/bookings\/[0-9a-f-]+\/pay$/);

    // คิวจบแล้ว (ได้ล็อค) — admin ไม่เห็นในคิวที่รออยู่
    await page.reload();
    await expect(page.getByRole('heading', { name: 'คิวรอ (0)' })).toBeVisible();
    await waiter.context().close();
  });
});
