import { type Page, expect, test } from '@playwright/test';
import { ADMIN_URL, E2E_ADMIN, WEB_URL } from '../env';
import {
  adminRequest,
  bangkokDate,
  expectNoHorizontalScroll,
  randomPhone,
  registerVendor,
} from '../helpers';

async function adminLogin(page: Page) {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel('ชื่อผู้ใช้').fill(E2E_ADMIN.username);
  await page.getByLabel('รหัสผ่าน').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.getByText(/^สวัสดี/)).toBeVisible();
}

test.describe('เช็คอินหน้างาน (Check-in)', () => {
  let cleanup: (() => Promise<void>) | null = null;

  test.afterEach(async () => {
    await cleanup?.();
    cleanup = null;
  });

  test('ผู้ค้าแสดง QR → เจ้าหน้าที่สแกน → สำเร็จ, สแกนซ้ำไม่นับซ้ำ, ผู้ค้าเห็นทันที; ค้นหาแล้วกดเช็คอิน; ผังแสดงเช็คอินแล้ว', async ({
    page,
    browser,
    request,
  }) => {
    const api = await adminRequest(request);
    const scannedPhone = randomPhone();
    const manualPhone = randomPhone();
    const vendorCtx = await browser.newContext({
      viewport: { width: 360, height: 740 },
      locale: 'th-TH',
      timezoneId: 'Asia/Bangkok',
      baseURL: WEB_URL,
    });
    const vendor = await vendorCtx.newPage();
    await registerVendor(vendor, scannedPhone, { firstName: 'สแกน', lastName: 'คิวอาร์' });
    const other = await vendorCtx.browser()!.newContext({ baseURL: WEB_URL });
    await registerVendor(await other.newPage(), manualPhone, {
      firstName: 'ค้นหา',
      lastName: 'ด้วยมือ',
    });
    await other.close();
    await api.approve(scannedPhone);
    await api.approve(manualPhone);

    const date = bangkokDate(120);
    const { roundId, dayIds } = await api.publishRound({
      name: `รอบเช็คอิน E2E ${Date.now() % 100_000}`,
      openAt: new Date(Date.now() - 60_000),
      closeAt: new Date(Date.now() + 86_400_000),
      dates: [date],
    });
    cleanup = () => api.cancelRound(roundId);
    const dayId = dayIds[0]!;
    for (const [phone, stallCode] of [
      [scannedPhone, 'A2'],
      [manualPhone, 'A4'],
    ] as const) {
      const bookingId = await api.bookForVendor({
        marketDayId: dayId,
        stallCode,
        vendorId: await api.vendorId(phone),
      });
      await api.payCash(bookingId);
    }
    // วันขายล่วงหน้า — เปิดเช็คอินตอนนี้เพื่อทดสอบ
    await api.setCheckinWindow(
      roundId,
      dayId,
      new Date(Date.now() - 3_600_000),
      new Date(Date.now() + 3_600_000),
    );

    // ผู้ค้า: การจองของฉัน → QR เช็คอิน
    await vendor.goto('/bookings');
    await vendor.getByRole('link', { name: 'QR เช็คอินหน้างาน' }).click();
    await expect(vendor).toHaveURL(/\/bookings\/[0-9a-f-]+\/checkin$/);
    const qr = vendor.getByRole('img', { name: 'QR เช็คอิน ล็อค A2' });
    await expect(qr).toBeVisible();
    // รูป PNG ที่ผู้ค้าเห็นจริง (data URL) — ไม่ใช้ screenshot ที่อาจถ่ายก่อนรูปวาดเสร็จ
    const src = (await qr.getAttribute('src')) ?? '';
    expect(src).toMatch(/^data:image\/png;base64,/);
    const qrImage = Buffer.from(src.split(',')[1]!, 'base64');

    // เจ้าหน้าที่: หน้าเช็คอินของวันนั้น → สแกนจากรูป
    await adminLogin(page);
    await page.getByRole('list').getByRole('link', { name: 'เช็คอินหน้างาน' }).click();
    await page.getByLabel('วันขาย').fill(date);
    await expect(page.getByText('เปิดเช็คอินอยู่')).toBeVisible();
    // เจ้าหน้าที่ใช้บนมือถือหน้างาน
    await page.setViewportSize({ width: 360, height: 740 });
    await expectNoHorizontalScroll(page);
    const count = page.getByLabel('จำนวนที่เช็คอินแล้ว');
    await expect(count).toHaveText('เช็คอินแล้ว 0 / 2 ล็อค');

    // กล้อง (จำลอง) เปิดแล้วมีภาพ → ปิดได้
    await page.getByRole('button', { name: 'เปิดกล้องสแกน QR' }).click();
    const video = page.getByLabel('ภาพจากกล้อง');
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth))
      .toBeGreaterThan(0);
    await page.getByRole('button', { name: 'ปิดกล้อง' }).click();
    await expect(video).toHaveCount(0);

    const upload = page.getByLabel('สแกนจากรูปภาพ');
    const result = page.getByRole('status', { name: 'ผลการเช็คอิน' });
    await upload.setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: qrImage });
    await expect(result).toContainText('เช็คอินสำเร็จ · ล็อค A2');
    await expect(result).toContainText('สแกน คิวอาร์');
    await expect(count).toHaveText('เช็คอินแล้ว 1 / 2 ล็อค');

    // สแกนซ้ำ → บอกว่าเช็คอินแล้ว ไม่นับซ้ำ
    await upload.setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: qrImage });
    await expect(result).toContainText('เช็คอินแล้ว · ล็อค A2');
    await expect(result).toContainText('ไม่นับซ้ำ');
    await expect(count).toHaveText('เช็คอินแล้ว 1 / 2 ล็อค');

    // หน้าผู้ค้าเปลี่ยนเองไม่ต้องรีเฟรช
    await expect(vendor.getByText('เช็คอินแล้ว', { exact: true })).toBeVisible();
    await expect(qr).toHaveCount(0);

    // สำรอง: ค้นหาด้วยรหัสล็อค → กดเช็คอิน → ยืนยัน
    await page.getByLabel('ค้นหา (รหัสล็อค / ชื่อ / ร้าน / เบอร์โทร)').fill('a4');
    const rows = page.getByRole('list', { name: 'รายการเช็คอิน' });
    await expect(rows.getByRole('listitem')).toHaveCount(1);
    await rows
      .getByRole('listitem', { name: 'ล็อค A4' })
      .getByRole('button', { name: 'เช็คอิน' })
      .click();
    await page
      .getByRole('dialog', { name: 'เช็คอินล็อค A4' })
      .getByRole('button', { name: 'ยืนยันเช็คอิน' })
      .click();
    await expect(result).toContainText('เช็คอินสำเร็จ · ล็อค A4');
    await expect(rows.getByRole('listitem', { name: 'ล็อค A4' })).toContainText(
      /เช็คอิน \d\d:\d\d/,
    );
    await expect(count).toHaveText('เช็คอินแล้ว 2 / 2 ล็อค');

    // ผังวันขายของ admin แสดงล็อคที่เช็คอินแล้ว
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${ADMIN_URL}/bookings?day=${dayId}`);
    await expect(page.locator('[data-stall-code="A2"]')).toHaveAttribute(
      'data-status',
      'CHECKED_IN',
    );
    await expect(page.getByRole('list', { name: 'คำอธิบายสี' })).toContainText('เช็คอินแล้ว');
    await vendorCtx.close();
  });
});
