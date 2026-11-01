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

test.describe('Admin: Dashboard, รายงาน, ประวัติการใช้งาน', () => {
  let cleanup: (() => Promise<void>) | null = null;

  test.afterEach(async () => {
    await cleanup?.();
    cleanup = null;
  });

  test('dashboard → รายงานรายได้/การใช้ล็อค/ผู้ค้า ของวันขาย → ดาวน์โหลด Excel → เห็นใน audit log', async ({
    page,
    browser,
    request,
  }) => {
    const api = await adminRequest(request);
    const vendorContext = await browser.newContext({ baseURL: WEB_URL, locale: 'th-TH' });
    const phone = randomPhone();
    await registerVendor(await vendorContext.newPage(), phone, {
      firstName: 'รายงาน',
      lastName: 'ยอดขาย',
    });
    await api.approve(phone);
    await vendorContext.close();

    const date = bangkokDate(100);
    const { roundId, dayIds } = await api.publishRound({
      name: `รอบรายงาน E2E ${Date.now() % 100_000}`,
      openAt: new Date(Date.now() - 60_000),
      closeAt: new Date(Date.now() + 86_400_000),
      dates: [date],
    });
    cleanup = () => api.cancelRound(roundId);
    const vendorId = await api.vendorId(phone);
    // A3 รับเงินสด 135 บาท (จองสำเร็จ), B4 ยังรอชำระ
    await api.bookForVendor({ marketDayId: dayIds[0]!, stallCode: 'A3', vendorId, cash: 135 });
    await api.bookForVendor({ marketDayId: dayIds[0]!, stallCode: 'B4', vendorId });

    // Dashboard
    await adminLogin(page);
    await expect(page.getByText('ผู้ค้ารออนุมัติ')).toBeVisible();
    await expect(page.getByText('สลิปรอตรวจ')).toBeVisible();

    // รายงานของวันขายนั้น (รอบเดียว)
    await page.getByRole('list').getByRole('link', { name: 'รายงาน' }).click();
    await expect(page.getByRole('heading', { name: 'รายงาน' })).toBeVisible();
    await page.goto(`${ADMIN_URL}/reports?from=${date}&to=${date}&round=${roundId}`);
    const revenue = page.getByRole('table', { name: 'รายได้' });
    await expect(revenue.getByRole('row')).toHaveCount(3); // หัว + วันขาย + รวม
    await expect(revenue.getByRole('row').nth(1)).toContainText('135 บาท');
    await expect(revenue.getByRole('row').nth(2)).toContainText('รวม');

    await page.getByRole('tab', { name: 'การใช้ล็อค' }).click();
    const occupancy = page.getByRole('table', { name: 'การใช้ล็อค' });
    const day = occupancy.getByRole('row').nth(1).getByRole('cell');
    await expect(day.nth(2)).toHaveText('1'); // จองสำเร็จ
    await expect(day.nth(3)).toHaveText('1'); // รอชำระ

    await page.getByRole('tab', { name: 'ผู้ค้า' }).click();
    const vendors = page.getByRole('table', { name: 'ผู้ค้า' });
    await expect(vendors.getByRole('row').filter({ hasText: 'รายงาน ยอดขาย' })).toContainText(
      '135 บาท',
    );

    await page.getByRole('tab', { name: 'รายได้' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Excel' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`revenue-day-${date}_${date}.xlsx`);

    // ประวัติการใช้งาน: การดาวน์โหลดเมื่อครู่
    await page.getByRole('list').getByRole('link', { name: 'ประวัติการใช้งาน' }).click();
    await page.getByRole('combobox', { name: 'การกระทำ' }).click();
    await page.getByRole('option', { name: 'ดาวน์โหลดรายงาน', exact: true }).click();
    const firstRow = page.getByRole('grid', { name: 'ประวัติการใช้งาน' }).getByRole('row').nth(1);
    await expect(firstRow).toContainText('ดาวน์โหลดรายงาน');
    await firstRow.click();
    const detail = page.getByRole('dialog', { name: 'ดาวน์โหลดรายงาน' });
    await expect(detail).toContainText('"report": "revenue"');
    await expect(detail).toContainText(`"from": "${date}"`);
  });
});
