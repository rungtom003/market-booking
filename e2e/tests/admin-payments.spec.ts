import { type Browser, type Page, expect, test } from '@playwright/test';
import { ADMIN_URL, E2E_ADMIN, WEB_URL } from '../env';
import { adminRequest, bangkokDate, makePng, randomPhone, registerVendor } from '../helpers';

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

const rnd = () => Math.floor(Math.random() * 256);

/** อัปโหลดรูปสลิป (PNG เล็กๆ) แล้วกดส่ง */
async function sendSlip(page: Page) {
  await page.getByLabel('รูปสลิป').setInputFiles({
    name: 'slip.png',
    mimeType: 'image/png',
    // สีสุ่ม = รูปไม่ซ้ำกับสลิปที่เคยอนุมัติ (ระบบปฏิเสธรูปสลิปซ้ำเอง — Phase 11.2)
    buffer: makePng(40, 60, [rnd(), rnd(), rnd()]),
  });
  await expect(page.getByText('อัปโหลดแล้ว')).toBeVisible();
  await page.getByRole('button', { name: 'ส่งสลิป' }).click();
  await expect(page.getByText('ส่งสลิปแล้ว รอเจ้าหน้าที่ตรวจ')).toBeVisible();
}

test.describe('ชำระเงินด้วยพร้อมเพย์ + ตรวจสลิป', () => {
  let cleanup: (() => Promise<void>) | null = null;

  test.afterEach(async () => {
    await cleanup?.();
    cleanup = null;
  });

  test('AC: จอง → ชำระ → admin อนุมัติ → ล็อคเป็น BOOKED และผู้ค้าเห็นจองสำเร็จ (ผ่านรอบไม่ผ่าน/ส่งใหม่)', async ({
    page,
    browser,
    request,
  }) => {
    const api = await adminRequest(request);
    await api.updateSettings({ payment_required: true, promptpay_id: '0812345678' });
    const ownerPhone = randomPhone();
    const owner = await vendorPage(browser);
    await registerVendor(owner, ownerPhone, { firstName: 'ผู้จ่าย', lastName: 'พร้อมเพย์' });
    await api.approve(ownerPhone);
    const viewerPhone = randomPhone();
    const viewer = await vendorPage(browser);
    await registerVendor(viewer, viewerPhone, { firstName: 'คนดู', lastName: 'ผัง' });
    await api.approve(viewerPhone);

    const { roundId, dayIds } = await api.publishRound({
      name: `รอบชำระเงิน E2E ${Date.now() % 100_000}`,
      openAt: new Date(Date.now() - 60_000),
      closeAt: new Date(Date.now() + 86_400_000),
      dates: [bangkokDate(70)],
      maxStallsPerVendor: 1,
    });
    cleanup = () => api.cancelRound(roundId);
    const dayId = dayIds[0]!;

    // จอง B6 → ยืนยัน → ไปหน้าชำระเงินเอง
    await owner.goto(`/days/${dayId}`);
    await stall(owner, 'B6').click();
    await owner.getByRole('button', { name: 'จองล็อคนี้' }).click();
    await owner.getByRole('button', { name: 'ยืนยันการจอง' }).click();
    await expect(owner).toHaveURL(/\/bookings\/[0-9a-f-]+\/pay$/);
    await expect(owner.getByRole('img', { name: 'QR พร้อมเพย์ ยอด 120 บาท' })).toBeVisible();
    await expect(owner.getByRole('link', { name: 'บันทึกรูป QR' })).toHaveAttribute(
      'download',
      'promptpay-B6.png',
    );
    await expect(owner.getByRole('timer', { name: 'เวลาที่เหลือในการชำระเงิน' })).toBeVisible();
    await sendSlip(owner);

    // admin: badge สลิปรอตรวจ → ไม่ผ่าน (คีย์ลัด R + เหตุผลด่วน)
    await adminLogin(page);
    const navBadge = page
      .getByRole('list')
      .getByRole('link', { name: /ตรวจสลิป/ })
      .locator('.MuiBadge-badge');
    await expect(navBadge).toHaveText('1');
    await page
      .getByRole('list')
      .getByRole('link', { name: /ตรวจสลิป/ })
      .click();
    await expect(page.getByText('ผู้จ่าย พร้อมเพย์ ·')).toBeVisible();
    await expect(page.getByText('120 บาท', { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'สลิปของ ผู้จ่าย พร้อมเพย์' })).toBeVisible();
    await page.keyboard.press('r');
    const reject = page.getByRole('dialog', { name: 'สลิปไม่ผ่าน' });
    await reject.getByRole('button', { name: 'ยอดเงินไม่ตรงกับที่ต้องชำระ' }).click();
    await reject.getByRole('button', { name: 'ยืนยันไม่ผ่าน' }).click();
    await expect(
      page.getByText('ไม่ผ่าน — แจ้ง ผู้จ่าย พร้อมเพย์ ให้ส่งสลิปใหม่แล้ว'),
    ).toBeVisible();
    await expect(page.getByText('ไม่มีสลิปรอตรวจ')).toBeVisible();

    // ผู้ค้าเห็นผลทันที (ไม่รีเฟรช) แล้วส่งใหม่ → คิวของ admin ขึ้นเอง
    await expect(owner.getByText('สลิปก่อนหน้าไม่ผ่านการตรวจ')).toBeVisible();
    await expect(owner.getByText('เหตุผล: ยอดเงินไม่ตรงกับที่ต้องชำระ').first()).toBeVisible();
    await sendSlip(owner);
    await expect(page.getByText('ผู้จ่าย พร้อมเพย์ ·')).toBeVisible();
    await expect(navBadge).toHaveText('1');

    // อนุมัติด้วยคีย์ลัด A
    await page.keyboard.press('a');
    await expect(
      page.getByText(/^อนุมัติแล้ว — ล็อค B6 ผู้จ่าย พร้อมเพย์ จองสำเร็จ/),
    ).toBeVisible();
    await expect(navBadge).toHaveClass(/MuiBadge-invisible/);

    // ผู้ค้าเห็นจองสำเร็จทันที + ประวัติครบ 2 ครั้ง
    await expect(owner.getByText('ชำระเงินเรียบร้อย')).toBeVisible();
    const history = owner.getByRole('list', { name: 'ประวัติการชำระ' }).getByRole('listitem');
    await expect(history).toHaveCount(2);
    await expect(history.nth(0)).toContainText('อนุมัติแล้ว');
    await expect(history.nth(1)).toContainText('ไม่ผ่าน');
    await owner.getByRole('link', { name: 'กลับไปการจองของฉัน' }).click();
    const card = owner.getByRole('listitem').filter({ hasText: 'ล็อค B6' });
    await expect(card.getByText('จองสำเร็จ', { exact: true })).toBeVisible();

    // ผู้ค้าอื่นเห็นล็อคเป็น "จองแล้ว"
    await viewer.goto(`/days/${dayId}`);
    await expect(stall(viewer, 'B6')).toHaveAttribute('data-status', 'BOOKED');
  });
});
