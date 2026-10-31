import { type Page, expect, test } from '@playwright/test';
import { ADMIN_URL, E2E_ADMIN } from '../env';
import { expectSeedStallsOnMap } from '../helpers';

async function adminLogin(page: Page) {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel('ชื่อผู้ใช้').fill(E2E_ADMIN.username);
  await page.getByLabel('รหัสผ่าน').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.getByText(/^สวัสดี/)).toBeVisible();
}

/** กดเมนูด้านข้าง (หน้าแรกมีลิงก์ชื่อเดียวกัน) */
const nav = (page: Page, name: string) =>
  page.getByRole('list').getByRole('link', { name }).click();

/** เลขสุ่มกันชนกับรอบก่อน (DB ของ E2E ไม่ถูกล้างระหว่างรอบ) */
const tag = () => String(Date.now() % 1_000_000);

test.describe('Admin: ตั้งค่าตลาด', () => {
  test('ผังตลาดแสดงล็อคจาก seed 20 ล็อคถูกตำแหน่ง', async ({ page }) => {
    await adminLogin(page);
    await nav(page, 'ล็อคและผังตลาด');
    await expect(page.getByRole('group', { name: 'ผังตลาด' })).toBeVisible();
    await expectSeedStallsOnMap(page);
  });

  test('สร้างหลายล็อค → คลิกบนผังแก้ตำแหน่ง → ลบ', async ({ page }) => {
    const prefix = `T${tag()}-`;
    await adminLogin(page);
    await page.goto(`${ADMIN_URL}/stalls`);

    await page.getByRole('button', { name: 'สร้างหลายล็อค' }).click();
    const bulk = page.getByRole('dialog', { name: 'สร้างหลายล็อค' });
    await bulk.getByLabel('คำนำหน้า').fill(prefix.toLowerCase());
    await bulk.getByLabel('เลขเริ่มต้น').fill('1');
    await bulk.getByLabel('เลขสิ้นสุด').fill('3');
    await expect(
      bulk.getByText(`จะสร้าง: ${prefix}1, ${prefix}2, ${prefix}3 (3 ล็อค)`),
    ).toBeVisible();
    await bulk.getByRole('button', { name: 'สร้างล็อค' }).click();
    await expect(page.getByText(`สร้าง 3 ล็อคแล้ว (${prefix}1–${prefix}3)`)).toBeVisible();

    // สร้างซ้ำ → ข้อความรหัสซ้ำ ไม่สร้างเพิ่ม
    await page.getByRole('button', { name: 'สร้างหลายล็อค' }).click();
    await bulk.getByLabel('คำนำหน้า').fill(prefix);
    await bulk.getByLabel('เลขเริ่มต้น').fill('3');
    await bulk.getByLabel('เลขสิ้นสุด').fill('4');
    await bulk.getByRole('button', { name: 'สร้างล็อค' }).click();
    await expect(bulk.getByText(`รหัสล็อคซ้ำกับที่มีอยู่แล้ว: ${prefix}3`)).toBeVisible();
    await bulk.getByRole('button', { name: 'ยกเลิก' }).click();

    // คลิกล็อคบนผัง → แก้ X
    const first = page.locator(`[data-stall-code="${prefix}1"]`);
    await first.click();
    const edit = page.getByRole('dialog', { name: `แก้ไขล็อค ${prefix}1` });
    await edit.getByLabel('X', { exact: true }).fill('905');
    await edit.getByRole('button', { name: 'บันทึก' }).click();
    await expect(page.getByText(`บันทึกล็อค ${prefix}1 แล้ว`)).toBeVisible();
    await expect(first.locator('rect')).toHaveAttribute('x', '905');

    // ลบทั้ง 3 ล็อค (ไม่มีการจอง) — เก็บกวาด DB ของ E2E ด้วย
    for (const n of [1, 2, 3]) {
      await page.locator(`[data-stall-code="${prefix}${n}"]`).click();
      await page.getByRole('button', { name: 'ลบล็อค' }).click();
      await page.getByRole('button', { name: 'ยืนยันลบ' }).click();
      await expect(page.getByText(`ลบล็อค ${prefix}${n} แล้ว`)).toBeVisible();
      await expect(page.locator(`[data-stall-code="${prefix}${n}"]`)).toHaveCount(0);
    }
  });

  test('ตารางล็อค: ค่าในฟอร์มผิดแสดงข้อความและไม่บันทึก', async ({ page }) => {
    await adminLogin(page);
    await page.goto(`${ADMIN_URL}/stalls`);
    await page.getByRole('tab', { name: /^ตาราง/ }).click();
    await page.getByRole('gridcell', { name: 'B1', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'แก้ไขล็อค B1' });
    await edit.getByLabel('ราคา/วัน (บาท)').fill('-5');
    await edit.getByRole('button', { name: 'บันทึก' }).click();
    await expect(edit.getByText('ราคาต้องไม่ติดลบ')).toBeVisible();
    await edit.getByRole('button', { name: 'ยกเลิก' }).click();
  });

  test('เพิ่มโซนพร้อมจำกัดประเภทสินค้า แล้วลบโซนว่างได้; โซนที่มีล็อคลบไม่ได้', async ({
    page,
  }) => {
    const name = `โซนทดสอบ${tag()}`;
    await adminLogin(page);
    await nav(page, 'โซนและประเภทสินค้า');

    // โซนจาก seed มีล็อค → ปุ่มลบปิด
    const foodRow = page.getByRole('row', { name: /โซนอาหาร/ });
    await expect(foodRow.getByRole('button', { name: 'ลบ' })).toBeDisabled();

    await page.getByRole('button', { name: 'เพิ่มโซน' }).click();
    const dialog = page.getByRole('dialog', { name: 'เพิ่มโซน' });
    await dialog.getByLabel('ชื่อโซน').fill(name);
    await dialog.getByLabel('สี (#RRGGBB)').fill('#a855f7');
    await dialog.getByLabel('เสื้อผ้า').check();
    await dialog.getByRole('button', { name: 'บันทึก' }).click();
    await expect(page.getByText(`บันทึกโซน ${name} แล้ว`)).toBeVisible();

    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row.getByText('เสื้อผ้า')).toBeVisible();
    await row.getByRole('button', { name: 'ลบ' }).click();
    await expect(page.getByText(`ลบโซน ${name} แล้ว`)).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
  });
});
