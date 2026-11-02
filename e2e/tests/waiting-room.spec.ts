import { expect, test } from '@playwright/test';
import { WEB_URL } from '../env';
import { adminRequest, bangkokDate, randomPhone, registerVendor } from '../helpers';

test.describe('Waiting Room (จอ 360px)', () => {
  let cleanup: (() => Promise<void>) | null = null;

  test.afterEach(async () => {
    await cleanup?.();
    cleanup = null;
  });

  test('หน้าจองเต็ม → คนที่สองเห็นลำดับคิวแทนผัง → เพิ่มที่ → ได้เข้าเองไม่ต้องรีเฟรช → จองได้', async ({
    page,
    browser,
    request,
  }) => {
    const admin = await adminRequest(request);
    const firstPhone = randomPhone();
    const secondPhone = randomPhone();
    await registerVendor(page, firstPhone, { firstName: 'เข้าก่อน', lastName: 'ได้ก่อน' });
    const second = await (
      await browser.newContext({
        viewport: { width: 360, height: 740 },
        locale: 'th-TH',
        timezoneId: 'Asia/Bangkok',
        baseURL: WEB_URL,
      })
    ).newPage();
    await registerVendor(second, secondPhone, { firstName: 'รอ', lastName: 'คิวหน้าจอง' });
    await admin.approve(firstPhone);
    await admin.approve(secondPhone);

    const { roundId, dayIds } = await admin.publishRound({
      name: `รอบคิวหน้าจอง E2E ${Date.now() % 100_000}`,
      openAt: new Date(Date.now() - 60_000),
      closeAt: new Date(Date.now() + 86_400_000),
      dates: [bangkokDate(140)],
      maxStallsPerVendor: 1,
      waitingRoomCapacity: 1,
    });
    cleanup = () => admin.cancelRound(roundId);
    const dayId = dayIds[0]!;

    // คนแรก: เข้าคิว → ได้เข้าหน้าจอง (worker ปล่อยทุก 3 วินาที)
    await page.goto(`/days/${dayId}`);
    await expect(page.getByRole('timer', { name: 'เวลาที่เหลือในหน้าจอง' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-stall-code="B2"]')).toBeVisible();

    // คนที่สอง: หน้าจองเต็ม → เห็นลำดับคิว ไม่เห็นผัง
    await second.goto(`/days/${dayId}`);
    await expect(second.getByRole('status', { name: 'ลำดับคิว' })).toHaveText('ลำดับที่ 1');
    await expect(second.getByText('รอทั้งหมด 1 คน')).toBeVisible();
    await expect(second.locator('[data-stall-code="B2"]')).toHaveCount(0);

    // เจ้าหน้าที่เพิ่มจำนวนคนในหน้าจอง → คนที่สองได้เข้าเอง (socket) แล้วจองได้
    await admin.updateRound(roundId, { waitingRoomCapacity: 2 });
    await expect(second.getByRole('timer', { name: 'เวลาที่เหลือในหน้าจอง' })).toBeVisible({
      timeout: 15_000,
    });
    await second.locator('[data-stall-code="B2"]').click();
    const sheet = second.getByRole('region', { name: 'ล็อค B2' });
    await sheet.getByRole('button', { name: /^จองล็อคนี้/ }).click();
    await expect(second.getByRole('region', { name: 'ยืนยันการจอง' })).toContainText('B2');
    await second.context().close();
  });
});
