import { expect, test } from '@playwright/test';
import {
  adminRequest,
  expectNoHorizontalScroll,
  expectSeedStallsOnMap,
  randomPhone,
  registerVendor,
} from '../helpers';

test.describe('ผู้ค้าดูผังตลาด (จอ 360px)', () => {
  test('ผู้ค้าที่อนุมัติแล้วเห็นล็อคจาก seed ถูกตำแหน่ง และแตะดูรายละเอียดได้', async ({
    page,
    request,
  }) => {
    const phone = randomPhone();
    await registerVendor(page, phone, { firstName: 'ดูผัง', lastName: 'ทดสอบ' });
    await (await adminRequest(request)).approve(phone);

    await page.reload();
    await page.getByRole('link', { name: 'ดูผังตลาด' }).click();
    await expect(page).toHaveURL(/\/map$/);
    const svg = page.getByRole('group', { name: 'ผังตลาด' });
    await expect(svg).toBeVisible();
    await expectSeedStallsOnMap(page);
    await expect(page.getByText('โซนอาหาร')).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.locator('[data-stall-code="A1"]').click();
    await expect(page.getByRole('heading', { name: 'ล็อค A1' })).toBeVisible();
    await expect(page.getByText('150 บาท / วัน')).toBeVisible();
    await expect(page.locator('[data-stall-code="A1"]')).toHaveAttribute('aria-pressed', 'true');

    // ซูมเข้าแล้ว viewBox แคบลง, "ดูทั้งผัง" กลับมาเท่าเดิม
    const initial = (await svg.getAttribute('viewBox')) ?? '';
    await page.getByRole('button', { name: 'ซูมเข้า' }).click();
    await expect(svg).not.toHaveAttribute('viewBox', initial);
    await page.getByRole('button', { name: 'ดูทั้งผัง' }).click();
    await expect(svg).toHaveAttribute('viewBox', initial);
  });

  test('ผู้ค้าที่ยังไม่อนุมัติเปิดผังไม่ได้ เห็นข้อความภาษาไทย', async ({ page }) => {
    await registerVendor(page, randomPhone(), { firstName: 'ยังไม่', lastName: 'อนุมัติ' });
    await page.goto('/map');
    await expect(page.getByText('บัญชีของคุณยังไม่ได้รับการอนุมัติ')).toBeVisible();
  });
});
