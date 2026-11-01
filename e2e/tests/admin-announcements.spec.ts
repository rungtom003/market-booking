import { type Page, expect, test } from '@playwright/test';
import { ADMIN_URL, E2E_ADMIN, WEB_URL } from '../env';
import { adminRequest, randomPhone, registerVendor } from '../helpers';

async function adminLogin(page: Page) {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel('ชื่อผู้ใช้').fill(E2E_ADMIN.username);
  await page.getByLabel('รหัสผ่าน').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.getByText(/^สวัสดี/)).toBeVisible();
}

test.describe('ประกาศ (Announcements)', () => {
  const prefix = `E2E ประกาศ ${Date.now() % 100_000}`;

  test.afterEach(async ({ request }) => {
    await (await adminRequest(request)).deleteAnnouncements(prefix);
  });

  test('admin สร้างประกาศปักหมุด + ตั้งเวลาล่วงหน้า → ผู้ค้าเห็นเฉพาะที่ถึงเวลาที่หน้าแรก → ลบแล้วหายไป', async ({
    page,
    browser,
  }) => {
    const pinned = `${prefix} งดขายวันพระ`;
    const scheduled = `${prefix} ล่วงหน้า`;

    await adminLogin(page);
    await page.getByRole('list').getByRole('link', { name: 'ประกาศ' }).click();
    await expect(page.getByRole('heading', { name: 'ประกาศ', level: 1 })).toBeVisible();

    // ประกาศที่แสดงทันที (ค่าเริ่มต้นของ "เริ่มแสดง" = ตอนนี้) + ปักหมุด + หลายบรรทัด
    await page.getByRole('button', { name: 'สร้างประกาศ' }).click();
    let dialog = page.getByRole('dialog', { name: 'สร้างประกาศ' });
    await dialog.getByLabel('หัวข้อ').fill(pinned);
    await dialog.getByLabel('รายละเอียด').fill('ตลาดปิด 1 วัน\nเปิดตามปกติวันถัดไป');
    await dialog.getByLabel('ปักหมุด (แสดงบนสุด)').check();
    await dialog.getByRole('button', { name: 'บันทึก' }).click();
    await expect(page.getByText(`สร้างประกาศ "${pinned}" แล้ว`)).toBeVisible();
    const pinnedItem = page.getByRole('listitem', { name: pinned });
    await expect(pinnedItem).toContainText('กำลังแสดง');
    await expect(pinnedItem).toContainText('ปักหมุด');

    // หยุดแสดงก่อนเริ่มแสดง → แจ้งที่ช่อง
    await page.getByRole('button', { name: 'สร้างประกาศ' }).click();
    dialog = page.getByRole('dialog', { name: 'สร้างประกาศ' });
    await dialog.getByLabel('หัวข้อ').fill(scheduled);
    await dialog.getByLabel('รายละเอียด').fill('ยังไม่ถึงเวลา');
    await dialog.getByLabel('เริ่มแสดง (เวลาไทย)').fill('2099-01-02T10:00');
    await dialog.getByLabel('หยุดแสดง (ไม่บังคับ)').fill('2099-01-01T10:00');
    await dialog.getByRole('button', { name: 'บันทึก' }).click();
    await expect(dialog.getByText('เวลาสิ้นสุดต้องหลังเวลาเผยแพร่')).toBeVisible();
    await dialog.getByLabel('หยุดแสดง (ไม่บังคับ)').fill('');
    await dialog.getByLabel('ส่ง LINE ถึงผู้ค้าทุกคนที่เชื่อม LINE', { exact: false }).check();
    await dialog.getByRole('button', { name: 'บันทึก' }).click();
    const scheduledItem = page.getByRole('listitem', { name: scheduled });
    await expect(scheduledItem).toContainText('ตั้งเวลาไว้');
    await expect(scheduledItem).toContainText('รอส่ง LINE');

    // ผู้ค้า (แม้ยังรออนุมัติ) เห็นประกาศที่ถึงเวลาแล้วที่หน้าแรก — ไม่เห็นที่ตั้งเวลาไว้
    const vendorCtx = await browser.newContext({
      viewport: { width: 360, height: 740 },
      locale: 'th-TH',
      timezoneId: 'Asia/Bangkok',
      baseURL: WEB_URL,
    });
    const vendor = await vendorCtx.newPage();
    await registerVendor(vendor, randomPhone(), { firstName: 'อ่าน', lastName: 'ประกาศ' });
    const board = vendor.getByRole('list', { name: 'ประกาศจากตลาด' });
    const article = board.getByRole('article', { name: pinned });
    await expect(article).toContainText('ปักหมุด');
    await expect(article).toContainText('เปิดตามปกติวันถัดไป');
    await expect(board.getByRole('article', { name: scheduled })).toHaveCount(0);

    // admin ลบ → ผู้ค้าโหลดใหม่ไม่เห็นแล้ว
    await pinnedItem.getByRole('button', { name: 'ลบ' }).click();
    await page
      .getByRole('dialog', { name: 'ลบประกาศ' })
      .getByRole('button', { name: 'ลบ' })
      .click();
    await expect(page.getByText(`ลบประกาศ "${pinned}" แล้ว`)).toBeVisible();
    await expect(pinnedItem).toHaveCount(0);
    await vendor.reload();
    await expect(vendor.getByText('รอการอนุมัติ')).toBeVisible();
    await expect(vendor.getByRole('article', { name: pinned })).toHaveCount(0);
    await vendorCtx.close();
  });
});
