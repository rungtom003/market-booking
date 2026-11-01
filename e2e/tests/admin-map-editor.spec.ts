import { type Locator, type Page, expect, test } from '@playwright/test';
import type { AdminMapLayout } from '@market-booking/shared';
import { ADMIN_URL, E2E_ADMIN, WEB_URL } from '../env';
import { adminRequest, makePng, randomPhone, registerVendor } from '../helpers';

async function adminLogin(page: Page) {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel('ชื่อผู้ใช้').fill(E2E_ADMIN.username);
  await page.getByLabel('รหัสผ่าน').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.getByText(/^สวัสดี/)).toBeVisible();
}

/** พิกัดผัง → พิกัดจอ จาก data-scale/x/y ของพื้นที่วาด (จอ = ผัง × scale + offset) */
async function toScreen(canvas: Locator, x: number, y: number) {
  const box = (await canvas.boundingBox())!;
  const [scale, ox, oy] = await Promise.all(
    ['data-scale', 'data-x', 'data-y'].map(async (a) => Number(await canvas.getAttribute(a))),
  );
  return { x: box.x + ox! + x * scale!, y: box.y + oy! + y * scale! };
}

const snap = (v: number) => Math.round(v / 10) * 10;

test.describe('Map Editor (ลากวางผังตลาด)', () => {
  let original: AdminMapLayout | null = null;
  let restore: (() => Promise<void>) | null = null;

  test.afterEach(async () => {
    await restore?.();
    restore = null;
  });

  test('ลากล็อค (snap กริด) + เพิ่มสัญลักษณ์ + คัดลอก/วาง + undo/redo → บันทึก → ผู้ค้าเห็นบนผัง', async ({
    page,
    browser,
    request,
  }) => {
    const api = await adminRequest(request);
    original = await api.layout();
    const snapshot = original;
    restore = () => api.restoreLayout(snapshot);
    const a1 = original.stalls.find((s) => s.code === 'A1')!;

    await adminLogin(page);
    await page.getByRole('list').getByRole('link', { name: 'ล็อคและผังตลาด' }).click();
    await page.getByRole('link', { name: 'แก้ไขผัง (ลากวาง)' }).click();
    await expect(page.getByRole('heading', { name: 'แก้ไขผังตลาด' })).toBeVisible();
    const canvas = page.getByRole('application', { name: 'พื้นที่แก้ไขผังตลาด' });
    const status = page.getByRole('status');
    await expect(status).toContainText('บันทึกแล้ว');
    // รอให้ดูทั้งผังเสร็จ (scale ถูกคำนวณจากขนาดจริงแล้ว)
    await expect(canvas).not.toHaveAttribute('data-scale', '1');

    // คลิกเลือก A1 แล้วลาก +43, +18 → ดูดเข้ากริด 10
    const center = await toScreen(canvas, a1.posX + a1.shapeW / 2, a1.posY + a1.shapeH / 2);
    await page.mouse.click(center.x, center.y);
    const inspector = page.getByLabel('คุณสมบัติ');
    await expect(inspector.getByText('ล็อค A1')).toBeVisible();
    const target = await toScreen(
      canvas,
      a1.posX + a1.shapeW / 2 + 43,
      a1.posY + a1.shapeH / 2 + 18,
    );
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.mouse.up();
    const movedX = snap(a1.posX + 43);
    const movedY = snap(a1.posY + 18);
    await expect(inspector.getByLabel('X')).toHaveValue(String(movedX));
    await expect(inspector.getByLabel('Y')).toHaveValue(String(movedY));
    await expect(status).toContainText('ยังไม่บันทึก 1 การเปลี่ยนแปลง');

    // เพิ่มสัญลักษณ์ห้องน้ำ + ป้าย
    await page.getByRole('button', { name: 'ห้องน้ำ', exact: true }).click();
    await expect(inspector.getByText('ห้องน้ำ', { exact: true })).toBeVisible();
    await inspector.getByLabel('ป้ายกำกับ (ไม่บังคับ)').fill('ห้องน้ำรวม');
    await inspector.getByLabel('ป้ายกำกับ (ไม่บังคับ)').press('Tab');
    await expect(status).toContainText('สัญลักษณ์ 1');

    // คัดลอก/วาง → 2 ชิ้น; undo → 1; redo → 2; undo อีกครั้งเหลือ 1
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(status).toContainText('สัญลักษณ์ 2');
    await page.keyboard.press('Control+z');
    await expect(status).toContainText('สัญลักษณ์ 1');
    await page.keyboard.press('Control+y');
    await expect(status).toContainText('สัญลักษณ์ 2');
    await page.getByRole('button', { name: 'ย้อนกลับ' }).click();
    await expect(status).toContainText('สัญลักษณ์ 1');

    await page.getByRole('button', { name: 'บันทึกผัง' }).click();
    await expect(page.getByText('บันทึกผังแล้ว')).toBeVisible();
    await expect(status).toContainText('บันทึกแล้ว');

    const saved = await api.layout();
    expect(saved.version).toBe(original.version + 1);
    expect(saved.stalls.find((s) => s.code === 'A1')).toMatchObject({ posX: movedX, posY: movedY });
    expect(saved.features).toEqual([
      expect.objectContaining({ kind: 'TOILET', label: 'ห้องน้ำรวม' }),
    ]);

    // ผู้ค้าเห็นตำแหน่งใหม่และสัญลักษณ์บนผังตลาด
    const vendorContext = await browser.newContext({ baseURL: WEB_URL, locale: 'th-TH' });
    const vendor = await vendorContext.newPage();
    const phone = randomPhone();
    await registerVendor(vendor, phone, { firstName: 'ดู', lastName: 'ผังใหม่' });
    await api.approve(phone);
    await vendor.goto('/map');
    await expect(vendor.getByRole('img', { name: 'ห้องน้ำ: ห้องน้ำรวม' })).toBeVisible();
    await expect(vendor.locator('[data-stall-code="A1"] rect').first()).toHaveAttribute(
      'x',
      String(movedX),
    );
    await vendorContext.close();
  });

  test('มีคนบันทึกผังก่อน → แจ้งให้โหลดผังล่าสุด', async ({ page, request }) => {
    const api = await adminRequest(request);
    const snapshot = await api.layout();
    restore = () => api.restoreLayout(snapshot);

    await adminLogin(page);
    await page.goto(`${ADMIN_URL}/stalls/editor`);
    await expect(page.getByRole('status')).toContainText('บันทึกแล้ว');
    await page.getByRole('button', { name: 'ข้อความ', exact: true }).click();

    // อีกคนบันทึกระหว่างนี้ (version เพิ่ม)
    await api.restoreLayout(snapshot);

    await page.getByRole('button', { name: 'บันทึกผัง' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'มีผู้อื่นบันทึกผังตลาดไปก่อนแล้ว' });
    await expect(alert).toBeVisible();
    await alert.getByRole('button', { name: 'โหลดผังล่าสุด' }).click();
    await expect(page.getByRole('status')).toContainText('สัญลักษณ์ 0');
    await expect(page.getByRole('status')).toContainText('บันทึกแล้ว');
  });

  test('ใส่รูปแปลนตลาดเป็นพื้นหลัง → ปรับความกว้าง → บันทึก', async ({ page, request }) => {
    const api = await adminRequest(request);
    const snapshot = await api.layout();
    restore = () => api.restoreLayout(snapshot);

    await adminLogin(page);
    await page.goto(`${ADMIN_URL}/stalls/editor`);
    await expect(page.getByRole('status')).toContainText('บันทึกแล้ว');
    await page.getByLabel('รูปแปลนตลาด').setInputFiles({
      name: 'plan.png',
      mimeType: 'image/png',
      buffer: makePng(400, 200, [240, 240, 220]),
    });
    await expect(page.getByText('ใส่รูปแปลนแล้ว — กดบันทึกเพื่อใช้จริง')).toBeVisible();
    const inspector = page.getByLabel('คุณสมบัติ');
    await expect(inspector.getByLabel('ความกว้างบนผัง')).toHaveValue('400');
    await inspector.getByLabel('ความกว้างบนผัง').fill('800');
    await inspector.getByLabel('ความกว้างบนผัง').press('Enter');
    await expect(inspector.getByText('สูง 400 (ตามสัดส่วนรูป)')).toBeVisible();

    await page.getByRole('button', { name: 'บันทึกผัง' }).click();
    await expect(page.getByText('บันทึกผังแล้ว')).toBeVisible();
    const saved = await api.layout();
    expect(saved.background).toMatchObject({ width: 800, height: 400 });
    expect(saved.background!.key).toMatch(/\/layout\/.+\.png$/);
  });
});
