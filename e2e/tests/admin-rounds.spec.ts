import { type Page, expect, test } from '@playwright/test';
import { ADMIN_URL, E2E_ADMIN } from '../env';

async function adminLogin(page: Page) {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel('ชื่อผู้ใช้').fill(E2E_ADMIN.username);
  await page.getByLabel('รหัสผ่าน').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.getByText(/^สวัสดี/)).toBeVisible();
}

/** ค่าช่อง datetime-local เวลาไทย อีก `ms` จากตอนนี้ เช่น "2026-11-02T10:00" */
const bangkokInput = (ms: number) =>
  new Date(Date.now() + ms + 7 * 3_600_000).toISOString().slice(0, 16);
const DAY = 86_400_000;

/** จำนวนเสาร์-อาทิตย์ของเดือนถัดจากเดือนของวันที่ (เวลาไทย) อีก `ms` จากตอนนี้ */
function weekendsOfMonthAfter(ms: number): number {
  const now = new Date(Date.now() + ms + 7 * 3_600_000);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // เดือนถัดไป (0-based)
  let count = 0;
  for (let d = new Date(Date.UTC(year, month, 1)); d.getUTCMonth() === month % 12;) {
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) count++;
    d = new Date(d.getTime() + DAY);
  }
  return count;
}

test.describe('Admin: รอบการจอง', () => {
  test('สร้างรอบ → เลือกเสาร์-อาทิตย์ทั้งเดือนจากปฏิทิน → เผยแพร่ → ปิดล็อค/ตั้งราคาเฉพาะวัน → ยกเลิกรอบ', async ({
    page,
  }) => {
    const name = `รอบ E2E ${Date.now() % 1_000_000}`;
    await adminLogin(page);
    await page.getByRole('list').getByRole('link', { name: 'รอบการจอง' }).click();

    await page.getByRole('button', { name: 'สร้างรอบ' }).click();
    const create = page.getByRole('dialog', { name: 'สร้างรอบการจอง' });
    await create.getByLabel('ชื่อรอบ').fill(name);
    await create.getByLabel('เปิดจอง (เวลาไทย)', { exact: true }).fill(bangkokInput(DAY));
    // ปิดก่อนเปิด → ข้อความใต้ช่อง ไม่บันทึก
    await create.getByLabel('ปิดจอง (เวลาไทย)', { exact: true }).fill(bangkokInput(DAY / 2));
    await create.getByRole('button', { name: 'บันทึก' }).click();
    await expect(create.getByText('เวลาปิดจองต้องหลังเวลาเปิดจอง')).toBeVisible();
    await create.getByLabel('ปิดจอง (เวลาไทย)', { exact: true }).fill(bangkokInput(2 * DAY));
    await create.getByRole('button', { name: 'บันทึก' }).click();

    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText(`สร้างรอบ ${name} แล้ว`)).toBeVisible();
    await expect(page.getByText('ร่าง', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'เผยแพร่รอบ' })).toBeDisabled();

    // ปฏิทินเปิดที่เดือนของวันแรกที่เลือกได้ (วันหลังปิดจอง) → กดเดือนถัดไป ทุกวันในเดือนเลือกได้
    const weekends = weekendsOfMonthAfter(3 * DAY);
    await page.getByRole('button', { name: 'เพิ่มวันขาย' }).click();
    const add = page.getByRole('dialog', { name: 'เพิ่มวันขาย' });
    await add.getByRole('button', { name: 'เดือนถัดไป' }).click();
    await add.getByRole('button', { name: 'เลือกเสาร์-อาทิตย์ทั้งเดือน' }).click();
    await expect(add.getByText(new RegExp(`^เลือก ${weekends} วัน:`))).toBeVisible();
    await expect(add.locator('[aria-pressed="true"]')).toHaveCount(weekends);
    await add.getByRole('button', { name: `เพิ่ม ${weekends} วัน` }).click();
    await expect(page.getByText(`เพิ่มวันขาย ${weekends} วันแล้ว`)).toBeVisible();
    const dayRows = page.getByRole('table', { name: 'วันขาย' }).getByRole('row');
    await expect(dayRows).toHaveCount(weekends + 1);

    // วันที่มีในรอบแล้วเลือกซ้ำไม่ได้
    await page.getByRole('button', { name: 'เพิ่มวันขาย' }).click();
    await add.getByRole('button', { name: 'เดือนถัดไป' }).click();
    const inRound = add.getByRole('button', { name: /\(มีในรอบแล้ว\)$/ });
    await expect(inRound).toHaveCount(weekends);
    await expect(inRound.first()).toBeDisabled();
    await add.getByRole('button', { name: 'ยกเลิก' }).click();

    await page.getByRole('button', { name: 'เผยแพร่รอบ' }).click();
    await expect(page.getByText('เผยแพร่รอบแล้ว ผู้ค้าเห็นรอบนี้แล้ว')).toBeVisible();
    await expect(page.getByText('รอเปิดจอง', { exact: true })).toBeVisible();

    // ตั้งค่าล็อคของวันแรก: ปิด A1, B1 ราคา 200
    await dayRows
      .nth(1)
      .getByRole('link', { name: /^ตั้งค่าล็อค/ })
      .click();
    await expect(page.getByRole('heading', { name: /^ตั้งค่าล็อค วัน/ })).toBeVisible();
    await page.locator('[data-stall-code="A1"]').click();
    const a1 = page.getByRole('dialog', { name: /^ล็อค A1 — / });
    await a1.getByLabel('ปิดล็อคนี้ในวันนี้').check();
    await a1.getByRole('button', { name: 'บันทึก' }).click();
    await expect(page.getByText('บันทึกล็อค A1 แล้ว')).toBeVisible();
    await expect(page.locator('[data-stall-code="A1"]')).toHaveAttribute(
      'data-status',
      'UNAVAILABLE',
    );

    await page.locator('[data-stall-code="B1"]').click();
    const b1 = page.getByRole('dialog', { name: /^ล็อค B1 — / });
    await b1.getByLabel('ราคาเฉพาะวันนี้ (บาท)').fill('-5');
    await b1.getByRole('button', { name: 'บันทึก' }).click();
    await expect(b1.getByText('ราคาต้องไม่ติดลบ')).toBeVisible();
    await b1.getByLabel('ราคาเฉพาะวันนี้ (บาท)').fill('200');
    await b1.getByRole('button', { name: 'บันทึก' }).click();
    await expect(page.getByText('บันทึกล็อค B1 แล้ว')).toBeVisible();

    const overrides = page.getByRole('table', { name: 'ล็อคที่ตั้งค่าเฉพาะวันนี้' });
    await expect(overrides.getByRole('row', { name: /^A1 ปิด/ })).toBeVisible();
    await expect(overrides.getByRole('row', { name: /^B1 เปิด 200 บาท/ })).toBeVisible();

    // กลับหน้ารอบ → จำนวน override ของวันแรก = 2 → ยกเลิกรอบ (เก็บกวาด DB ของ E2E ด้วย)
    await page.getByRole('link', { name }).click();
    await expect(dayRows.nth(1).getByRole('cell').nth(2)).toHaveText('2');
    await page.getByRole('button', { name: 'ยกเลิกรอบ' }).click();
    await page.getByRole('button', { name: 'ยืนยันยกเลิกรอบ' }).click();
    await expect(page.getByText('ยกเลิกรอบแล้ว')).toBeVisible();
    await expect(page.getByText('ยกเลิกแล้ว', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'เพิ่มวันขาย' })).toHaveCount(0);
  });
});
