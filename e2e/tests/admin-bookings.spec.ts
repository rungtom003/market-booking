import { type Browser, type Page, expect, test } from '@playwright/test';
import { ADMIN_URL, E2E_ADMIN, WEB_URL } from '../env';
import { adminRequest, bangkokDate, randomPhone, registerVendor } from '../helpers';

/** หน้าต่างผู้ค้า (จอมือถือ) คนละ session กับ admin */
async function vendorPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    baseURL: WEB_URL,
  });
  return context.newPage();
}

async function adminLogin(page: Page) {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel('ชื่อผู้ใช้').fill(E2E_ADMIN.username);
  await page.getByLabel('รหัสผ่าน').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.getByText(/^สวัสดี/)).toBeVisible();
}

const stall = (page: Page, code: string) => page.locator(`[data-stall-code="${code}"]`);

test.describe('Admin: จัดการการจอง', () => {
  let cleanup: (() => Promise<void>) | null = null;

  test.afterEach(async () => {
    await cleanup?.();
    cleanup = null;
  });

  test('AC: admin ยกเลิก → เจ้าของและผู้ดูผังคนอื่นเห็นทันที; จองแทน; ตาราง; export', async ({
    page,
    browser,
    request,
  }) => {
    const api = await adminRequest(request);
    const ownerPhone = randomPhone();
    const owner = await vendorPage(browser);
    await registerVendor(owner, ownerPhone, { firstName: 'เจ้าของ', lastName: 'ล็อคบีสอง' });
    await api.approve(ownerPhone);
    const viewer = await vendorPage(browser);
    const viewerPhone = randomPhone();
    await registerVendor(viewer, viewerPhone, { firstName: 'คนดู', lastName: 'ผัง' });
    await api.approve(viewerPhone);

    const { roundId, dayIds } = await api.publishRound({
      name: `รอบ admin จัดการ ${Date.now() % 100_000}`,
      openAt: new Date(Date.now() - 60_000),
      closeAt: new Date(Date.now() + 86_400_000),
      dates: [bangkokDate(60)],
      maxStallsPerVendor: 1,
    });
    cleanup = () => api.cancelRound(roundId);
    const dayId = dayIds[0]!;

    // ผู้ค้าจอง B2 และยืนยัน; อีกคนเปิดผังวันเดียวกันไว้
    await owner.goto(`/days/${dayId}`);
    await stall(owner, 'B2').click();
    await owner.getByRole('button', { name: 'จองล็อคนี้' }).click();
    await owner.getByRole('button', { name: 'ยืนยันการจอง' }).click();
    // ยืนยันแล้วไปหน้าชำระเงิน — กลับมาดูผังต่อ
    await expect(owner).toHaveURL(/\/bookings\/[0-9a-f-]+\/pay$/);
    await owner.goto(`/days/${dayId}`);
    await expect(stall(owner, 'B2')).toHaveAttribute('data-status', 'MINE');
    await viewer.goto(`/days/${dayId}`);
    await expect(stall(viewer, 'B2')).toHaveAttribute('data-status', 'BOOKED');

    // admin เห็นชื่อผู้ค้าในผัง → ยกเลิกพร้อมเหตุผล
    await adminLogin(page);
    await page.getByRole('list').getByRole('link', { name: 'จัดการการจอง' }).click();
    await page.goto(`${ADMIN_URL}/bookings?day=${dayId}`);
    await expect(page.getByRole('button', { name: 'ล็อค B2 เจ้าของ ล็อคบีสอง' })).toBeVisible();
    await stall(page, 'B2').click();
    const detail = page.getByRole('dialog', { name: /^ล็อค B2/ });
    await expect(detail.getByText('เจ้าของ ล็อคบีสอง')).toBeVisible();
    await detail.getByRole('button', { name: 'ยกเลิกการจอง' }).click();
    const cancel = page.getByRole('dialog', { name: 'ยกเลิกการจอง' });
    await expect(cancel.getByRole('button', { name: 'ยืนยันยกเลิก' })).toBeDisabled();
    await cancel.getByLabel('เหตุผล (ผู้ค้าเห็นข้อความนี้)').fill('ใช้พื้นที่จัดเวทีกิจกรรม');
    await cancel.getByRole('button', { name: 'ยืนยันยกเลิก' }).click();
    await expect(page.getByText('ยกเลิกการจองล็อค B2 — เจ้าของ ล็อคบีสอง แล้ว')).toBeVisible();

    // ทั้งเจ้าของและคนอื่นที่ดูผังอยู่เห็นล็อคว่างทันที (ไม่รีเฟรช)
    await expect(stall(viewer, 'B2')).toHaveAttribute('data-status', 'AVAILABLE', {
      timeout: 2_000,
    });
    await expect(stall(owner, 'B2')).toHaveAttribute('data-status', 'AVAILABLE', {
      timeout: 2_000,
    });
    await owner.getByRole('link', { name: 'การจอง' }).click();
    const card = owner.getByRole('listitem').filter({ hasText: 'ล็อค B2' });
    await expect(card.getByText('ยกเลิกโดยเจ้าหน้าที่ — ใช้พื้นที่จัดเวทีกิจกรรม')).toBeVisible();

    // จองแทนผู้ค้า (B4) → ผังของผู้ค้าเป็น "ของฉัน" เอง
    await owner.goto(`/days/${dayId}`);
    await stall(page, 'B4').click();
    const book = page.getByRole('dialog', { name: /^ล็อค B4/ });
    await book.getByLabel('ผู้ค้า (ชื่อ / ร้าน / เบอร์)').fill(ownerPhone);
    // รอผลค้นหาด้วยเบอร์ (ชื่อซ้ำกับผู้ค้าจาก E2E รอบก่อนได้)
    const formatted = ownerPhone.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
    await page.getByRole('option', { name: `เจ้าของ ล็อคบีสอง · ${formatted}` }).click();
    await book.getByRole('button', { name: 'จองแทน' }).click();
    await expect(page.getByText('จองล็อค B4 ให้ เจ้าของ ล็อคบีสอง แล้ว')).toBeVisible();
    await expect(stall(owner, 'B4')).toHaveAttribute('data-status', 'MINE', { timeout: 2_000 });
    await expect(stall(page, 'B4')).toHaveAttribute('data-status', 'BOOKED');

    // ตาราง: การจองที่ยังมีผลของวันนี้
    await page.getByRole('tab', { name: 'ตาราง' }).click();
    const row = page.getByRole('row', { name: /^B4 เจ้าของ ล็อคบีสอง/ });
    await expect(row.getByText('จองสำเร็จ')).toBeVisible();
    await expect(page.getByRole('row', { name: /^B2 / })).toHaveCount(0);

    // export รายชื่อ
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'ดาวน์โหลดรายชื่อ (xlsx)' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`bookings-${bangkokDate(60)}.xlsx`);
  });
});
