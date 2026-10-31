import { type Browser, type Page, expect, test } from '@playwright/test';
import { adminRequest, bangkokDate, randomPhone, registerVendor } from '../helpers';

/** ผู้ค้าที่อนุมัติแล้ว (login อยู่ในหน้า `page`) */
async function approvedVendor(page: Page, admin: Awaited<ReturnType<typeof adminRequest>>) {
  const phone = randomPhone();
  await registerVendor(page, phone, { firstName: 'ผู้ค้า', lastName: phone.slice(-4) });
  await admin.approve(phone);
  return phone;
}

/** หน้าต่างผู้ค้าคนที่สอง — จอมือถือเหมือน project หลัก */
async function secondPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    hasTouch: true,
    isMobile: true,
  });
  return context.newPage();
}

const stall = (page: Page, code: string) => page.locator(`[data-stall-code="${code}"]`);
const holdPanel = (page: Page) => page.getByRole('region', { name: 'ยืนยันการจอง' });

/** วันขายแต่ละ test ไม่ชนกัน (วันที่ของรอบที่ยังไม่ยกเลิกต้องไม่ซ้ำ) */
let dayOffset = 20;

test.describe('ผู้ค้าจองล็อค (จอ 360px)', () => {
  let cleanup: (() => Promise<void>) | null = null;

  test.afterEach(async () => {
    await cleanup?.();
    cleanup = null;
  });

  async function openRound(
    admin: Awaited<ReturnType<typeof adminRequest>>,
    opts: { openInMs?: number } = {},
  ) {
    const openAt = new Date(Date.now() + (opts.openInMs ?? -60_000));
    const { roundId, dayIds } = await admin.publishRound({
      name: `รอบจอง E2E ${Date.now() % 100_000}`,
      openAt,
      closeAt: new Date(Date.now() + 86_400_000),
      dates: [bangkokDate(dayOffset++)],
      maxStallsPerVendor: 1,
    });
    cleanup = () => admin.cancelRound(roundId);
    return dayIds[0]!;
  }

  test('AC: 2 ผู้ค้าแย่งล็อคเดียว → คนหนึ่งได้, อีกคนเห็น STALL_TAKEN และผังอัปเดต', async ({
    page,
    browser,
    request,
  }) => {
    const admin = await adminRequest(request);
    await approvedVendor(page, admin);
    const other = await secondPage(browser);
    await approvedVendor(other, admin);
    const dayId = await openRound(admin);

    for (const p of [page, other]) {
      await p.goto(`/days/${dayId}`);
      await expect(p.getByText(/^เปิดจองแล้ว/)).toBeVisible();
      await stall(p, 'B3').click();
      await expect(p.getByRole('button', { name: 'จองล็อคนี้' })).toBeEnabled();
    }
    // กดพร้อมกัน
    await Promise.all([
      page.getByRole('button', { name: 'จองล็อคนี้' }).click(),
      other.getByRole('button', { name: 'จองล็อคนี้' }).click(),
    ]);

    const pageWon = await holdPanel(page)
      .waitFor({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    const [winner, loser] = pageWon ? [page, other] : [other, page];

    await expect(holdPanel(winner)).toBeVisible();
    await expect(stall(winner, 'B3')).toHaveAttribute('data-status', 'MINE');
    await expect(loser.getByText('ล็อคนี้มีผู้จองแล้ว กรุณาเลือกล็อคอื่น')).toBeVisible();
    await expect(stall(loser, 'B3')).toHaveAttribute('data-status', 'HELD');
    // แนะนำล็อคว่างใกล้เคียง (B2/B4 อยู่ติดกัน)
    await expect(loser.getByText('ล็อคว่างใกล้เคียง:')).toBeVisible();
    await expect(stall(loser, 'B2')).toHaveAttribute('data-highlighted', 'true');

    // ผู้ชนะยืนยัน → ผังของอีกคนเปลี่ยนเป็น "จองแล้ว" เอง (socket)
    await holdPanel(winner).getByRole('button', { name: 'ยืนยันการจอง' }).click();
    await expect(winner.getByText(/^จองล็อค B3 แล้ว — กรุณาชำระ 120 บาท ภายใน/)).toBeVisible();
    await expect(stall(loser, 'B3')).toHaveAttribute('data-status', 'BOOKED', { timeout: 2_000 });
  });

  test('AC: เน็ตหลุด 10 วินาทีแล้วกลับมา → ผังถูกต้องโดยไม่ต้องรีเฟรช', async ({
    page,
    browser,
    request,
  }) => {
    const admin = await adminRequest(request);
    await approvedVendor(page, admin);
    const other = await secondPage(browser);
    await approvedVendor(other, admin);
    const dayId = await openRound(admin);

    await page.goto(`/days/${dayId}`);
    await expect(stall(page, 'B5')).toHaveAttribute('data-status', 'AVAILABLE');

    await page.context().setOffline(true);
    // ระหว่างหลุด อีกคนจองล็อค B5
    await other.goto(`/days/${dayId}`);
    await stall(other, 'B5').click();
    await other.getByRole('button', { name: 'จองล็อคนี้' }).click();
    await expect(holdPanel(other)).toBeVisible();
    await page.waitForTimeout(10_000);
    await page.context().setOffline(false);

    await expect(stall(page, 'B5')).toHaveAttribute('data-status', 'HELD', { timeout: 10_000 });
    await expect(page.getByText('กำลังเชื่อมต่อใหม่…')).toHaveCount(0, { timeout: 10_000 });
  });

  test('ก่อนรอบเปิด: ดูผังได้แต่จองไม่ได้ + นับถอยหลัง → เปิดแล้วปุ่มใช้ได้ทันทีไม่ต้องรีเฟรช', async ({
    page,
    request,
  }) => {
    const admin = await adminRequest(request);
    await approvedVendor(page, admin);
    const dayId = await openRound(admin, { openInMs: 12_000 });

    await page.goto(`/days/${dayId}`);
    await expect(page.getByRole('timer', { name: 'เวลาที่เหลือก่อนเปิดจอง' })).toBeVisible();
    await stall(page, 'B6').click();
    await expect(page.getByRole('button', { name: 'ยังไม่เปิดจอง' })).toBeDisabled();

    await expect(page.getByRole('button', { name: 'จองล็อคนี้' })).toBeEnabled({
      timeout: 20_000,
    });
    await expect(page.getByText(/^เปิดจองแล้ว/)).toBeVisible();
  });

  test('จอง → ยืนยันจากหน้า "การจองของฉัน" → จองล็อคที่สองเกินโควตา → ยกเลิก', async ({
    page,
    request,
  }) => {
    const admin = await adminRequest(request);
    await approvedVendor(page, admin);
    const dayId = await openRound(admin);

    await page.goto(`/days/${dayId}`);
    await stall(page, 'B7').click();
    await page.getByRole('button', { name: 'จองล็อคนี้' }).click();
    await expect(holdPanel(page).getByRole('timer')).toHaveText(/^(10:00|0\d:\d{2})$/);

    await page.getByRole('link', { name: 'การจอง' }).click();
    const card = page.getByRole('listitem').filter({ hasText: 'ล็อค B7' });
    await expect(card.getByText('รอยืนยัน')).toBeVisible();
    await card.getByRole('button', { name: 'ยืนยันการจอง' }).click();
    await expect(page.getByText('ยืนยันล็อค B7 แล้ว รอชำระเงิน')).toBeVisible();
    await expect(card.getByText('รอชำระเงิน', { exact: true })).toBeVisible();

    // วันนี้จองได้ 1 ล็อค
    await card.getByRole('link', { name: 'ดูผังวันนี้' }).click();
    await expect(stall(page, 'B7')).toHaveAttribute('data-status', 'MINE');
    await stall(page, 'B8').click();
    await page.getByRole('button', { name: 'จองล็อคนี้' }).click();
    await expect(page.getByText('คุณจองครบจำนวนที่กำหนดสำหรับวันนี้แล้ว')).toBeVisible();
    await expect(stall(page, 'B8')).toHaveAttribute('data-status', 'AVAILABLE');

    await page.getByRole('link', { name: 'การจอง' }).click();
    await card.getByRole('button', { name: 'ยกเลิกการจอง' }).click();
    await card.getByRole('button', { name: 'ยืนยันยกเลิก' }).click();
    await expect(page.getByText('ยกเลิกการจองล็อค B7 แล้ว')).toBeVisible();
    await expect(card.getByText('ยกเลิกแล้ว', { exact: true })).toBeVisible();
    await expect(card.getByText('คุณยกเลิกเอง')).toBeVisible();
  });
});
