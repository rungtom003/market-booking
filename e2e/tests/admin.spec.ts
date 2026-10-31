import { type Browser, type Page, expect, test } from '@playwright/test';
import { ADMIN_URL, E2E_ADMIN } from '../env';
import { loginWithOtp, randomPhone, registerVendor } from '../helpers';

/** เปิดหน้าเว็บผู้ค้าในหน้าต่างแยก (จอมือถือ) — admin กับผู้ค้าเป็นคนละ session */
async function vendorPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
    locale: 'th-TH',
  });
  return context.newPage();
}

async function adminLogin(
  page: Page,
  username = E2E_ADMIN.username,
  password = E2E_ADMIN.password,
) {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน').fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.getByText(/^สวัสดี/)).toBeVisible();
}

/** เปิดหน้ารายการผู้ค้า ค้นหาด้วยเบอร์ แล้วเปิด drawer ของคนนั้น */
async function openVendor(page: Page, phone: string, tab = /^รออนุมัติ/) {
  await page.goto(`${ADMIN_URL}/vendors`);
  await page.getByRole('tab', { name: tab }).click();
  await page.getByLabel('ค้นหา ชื่อ / ร้าน / เบอร์').fill(phone);
  await page
    .getByRole('gridcell', { name: phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3') })
    .click();
  return page.getByRole('region', { name: 'รายละเอียดผู้ค้า' });
}

test.describe('Admin: อนุมัติสมาชิก', () => {
  test('admin login → อนุมัติผู้ค้า PENDING → ผู้ค้ารีเฟรชแล้วเป็น APPROVED', async ({
    page,
    browser,
  }) => {
    const phone = randomPhone();
    const vendor = await vendorPage(browser);
    await registerVendor(vendor, phone, { firstName: 'รออนุมัติ', lastName: 'จากแอดมิน' });

    await adminLogin(page);
    // badge จำนวนรออนุมัติในเมนู
    await expect(page.getByRole('link', { name: /ผู้ค้า/ }).first()).toBeVisible();

    const drawer = await openVendor(page, phone);
    await expect(drawer.getByText('รออนุมัติ จากแอดมิน')).toBeVisible();
    await drawer.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    await expect(drawer.getByText('อนุมัติแล้ว')).toBeVisible();
    await expect(drawer.getByText(/ตรวจโดย/)).toBeVisible();

    await vendor.reload();
    await expect(vendor.getByText('บัญชีได้รับการอนุมัติแล้ว')).toBeVisible();
  });

  test('ไม่อนุมัติพร้อมเหตุผล → ผู้ค้าเห็นเหตุผล', async ({ page, browser }) => {
    const phone = randomPhone();
    const vendor = await vendorPage(browser);
    await registerVendor(vendor, phone, { firstName: 'ไม่ผ่าน', lastName: 'ทดสอบ' });

    await adminLogin(page);
    const drawer = await openVendor(page, phone);
    await drawer.getByRole('button', { name: 'ไม่อนุมัติ' }).click();
    const dialog = page.getByRole('dialog', { name: 'ไม่อนุมัติผู้ค้า' });
    await expect(dialog.getByRole('button', { name: 'ยืนยันไม่อนุมัติ' })).toBeDisabled();
    await dialog.getByLabel('เหตุผล').fill('รูปบัตรไม่ชัด กรุณาถ่ายใหม่');
    await dialog.getByRole('button', { name: 'ยืนยันไม่อนุมัติ' }).click();
    await expect(
      drawer.getByText('เหตุผลที่ไม่อนุมัติ: รูปบัตรไม่ชัด กรุณาถ่ายใหม่'),
    ).toBeVisible();

    await vendor.reload();
    await expect(vendor.getByText('เหตุผล: รูปบัตรไม่ชัด กรุณาถ่ายใหม่')).toBeVisible();
  });

  test('เลือกหลายรายการแล้วอนุมัติพร้อมกัน', async ({ page, browser }) => {
    const tag = `กลุ่ม${Date.now() % 100000}`;
    const vendor = await vendorPage(browser);
    for (const n of [1, 2]) {
      await vendor.context().clearCookies();
      await registerVendor(vendor, randomPhone(), { firstName: tag, lastName: `คนที่${n}` });
    }

    await adminLogin(page);
    await page.goto(`${ADMIN_URL}/vendors`);
    await page.getByLabel('ค้นหา ชื่อ / ร้าน / เบอร์').fill(tag);
    await expect(page.getByRole('gridcell', { name: `${tag} คนที่2` })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Select all rows' }).check();
    await page.getByRole('button', { name: 'อนุมัติที่เลือก (2)' }).click();
    await expect(page.getByText('อนุมัติ 2 ราย')).toBeVisible();
  });
});

test.describe('Admin: ตั้งค่าและสิทธิ์', () => {
  test('เปลี่ยน registration_mode เป็นอัตโนมัติ แล้วผู้ค้าใหม่ได้ APPROVED ทันที', async ({
    page,
    browser,
  }) => {
    await adminLogin(page);
    await page.goto(`${ADMIN_URL}/settings`);
    const autoSwitch = page.getByRole('switch', { name: 'อนุมัติสมาชิกอัตโนมัติ' });
    await expect(autoSwitch).not.toBeChecked();
    try {
      await autoSwitch.check();
      await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
      await expect(page.getByText('บันทึกการตั้งค่าแล้ว')).toBeVisible();

      // registerVendor รอข้อความ "รอการอนุมัติ" — โหมด AUTO ได้ "อนุมัติแล้ว" แทน จึงกรอกเอง
      const vendor = await vendorPage(browser);
      await loginWithOtp(vendor, randomPhone());
      await vendor.getByRole('textbox', { name: 'ชื่อ', exact: true }).fill('อัตโนมัติ');
      await vendor.getByLabel('นามสกุล').fill('ทดสอบ');
      await vendor.getByLabel('ที่อยู่').fill('1 ถนนทดสอบ กรุงเทพฯ');
      await vendor.getByLabel(/ฉันยินยอมให้เก็บและใช้ข้อมูลส่วนบุคคล/).check();
      await vendor.getByRole('button', { name: 'สมัครสมาชิก' }).click();
      await expect(vendor.getByText('บัญชีได้รับการอนุมัติแล้ว')).toBeVisible();
    } finally {
      // คืนค่าเดิม — test อื่นใน DB เดียวกันคาดว่าเป็น MANUAL
      await page.goto(`${ADMIN_URL}/settings`);
      if (await autoSwitch.isChecked()) {
        await autoSwitch.uncheck();
        await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
        await expect(page.getByText('บันทึกการตั้งค่าแล้ว')).toBeVisible();
      }
    }
  });

  test('ค่าผิดในฟอร์มตั้งค่าแสดงข้อผิดพลาดและไม่บันทึก', async ({ page }) => {
    await adminLogin(page);
    await page.goto(`${ADMIN_URL}/settings`);
    await page.getByLabel('เวลาให้กดยืนยันหลังเลือกล็อค').fill('0');
    await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await expect(page.getByText(/ควรมีค่าอย่างน้อย|ต้องมีค่า|1/).first()).toBeVisible();
    await expect(page.getByText('บันทึกการตั้งค่าแล้ว')).toHaveCount(0);
  });

  test('SUPER_ADMIN เพิ่มเจ้าหน้าที่ → เจ้าหน้าที่ไม่เห็นเมนูตั้งค่า และเข้า /settings ได้ 403', async ({
    page,
    browser,
  }) => {
    const username = `staff${Date.now() % 1_000_000}`;
    await adminLogin(page);
    await page.goto(`${ADMIN_URL}/users`);
    await page.getByRole('button', { name: 'เพิ่มผู้ดูแล' }).click();
    const dialog = page.getByRole('dialog', { name: 'เพิ่มผู้ดูแล' });
    await dialog.getByLabel('ชื่อผู้ใช้').fill(username);
    await dialog.getByLabel('ชื่อที่แสดง').fill('เจ้าหน้าที่ทดสอบ');
    await dialog.getByLabel('รหัสผ่าน').fill('staff-password-123');
    await dialog.getByRole('button', { name: 'เพิ่ม' }).click();
    await expect(page.getByText(`เพิ่ม ${username} แล้ว`)).toBeVisible();

    const staff = await (await browser.newContext({ locale: 'th-TH' })).newPage();
    await adminLogin(staff, username, 'staff-password-123');
    await expect(staff.getByRole('link', { name: /ผู้ค้า/ }).first()).toBeVisible();
    await expect(staff.getByRole('link', { name: 'ตั้งค่าระบบ' })).toHaveCount(0);
    await expect(staff.getByRole('link', { name: 'ผู้ดูแลระบบ' })).toHaveCount(0);
    await expect(staff.getByRole('link', { name: 'ล็อคและผังตลาด' })).toHaveCount(0);

    await staff.goto(`${ADMIN_URL}/settings`);
    await expect(staff.getByText('คุณไม่มีสิทธิ์เข้าถึงหน้านี้')).toBeVisible();
  });

  test('รหัสผิดแสดงข้อความภาษาไทย', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/login`);
    await page.getByLabel('ชื่อผู้ใช้').fill(E2E_ADMIN.username);
    await page.getByLabel('รหัสผ่าน').fill('wrong-password');
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
    await expect(page.getByText('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')).toBeVisible();
  });
});
