import { expect, test } from '@playwright/test';
import {
  adminRequest,
  expectNoHorizontalScroll,
  loginWithOtp,
  makePng,
  randomPhone,
  readOtp,
} from '../helpers';

// รูปใหญ่กว่า 1600px — ทดสอบว่าเบราว์เซอร์ย่อ/บีบอัดเป็น JPEG ก่อนอัปโหลด
const SHOP_PNG = makePng(2000, 1200, [22, 163, 74]);

test.describe('ผู้ค้าใหม่สมัครสมาชิก (จอ 360px)', () => {
  test('OTP → สมัคร (แนบรูปร้าน) → เห็นหน้ารออนุมัติ และยังอยู่หลังรีเฟรช', async ({ page }) => {
    const phone = randomPhone();

    await loginWithOtp(page, phone);

    // เบอร์ใหม่ → ไปหน้าสมัคร พร้อมเบอร์ที่ยืนยันแล้ว
    await expect(page).toHaveURL(/\/register$/);
    await expect(
      page.getByText(phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3')),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.getByRole('textbox', { name: 'ชื่อ', exact: true }).fill('สมใจ');
    await page.getByLabel('นามสกุล').fill('ขายดี');
    await page.getByLabel('ที่อยู่').fill('12 ถนนตลาดนัด เขตบางกะปิ กรุงเทพฯ');
    await page.getByLabel('ชื่อร้าน').fill('ร้านสมใจผลไม้');
    await page.getByLabel('ประเภทสินค้า').selectOption({ label: 'อาหาร' });
    await page.getByLabel('รูปร้าน/สินค้า').setInputFiles({
      name: 'shop.png',
      mimeType: 'image/png',
      buffer: SHOP_PNG,
    });
    await expect(page.getByText('อัปโหลดแล้ว')).toBeVisible();

    // ยังไม่ติ๊ก PDPA → ส่งไม่ได้
    await page.getByRole('button', { name: 'สมัครสมาชิก' }).click();
    await expect(page.getByText('กรุณายอมรับนโยบายความเป็นส่วนตัว')).toBeVisible();

    await page.getByLabel(/ฉันยินยอมให้เก็บและใช้ข้อมูลส่วนบุคคล/).check();
    await page.getByRole('button', { name: 'สมัครสมาชิก' }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('รอการอนุมัติ')).toBeVisible();
    await expect(page.getByText('ร้านสมใจผลไม้')).toBeVisible();
    await expectNoHorizontalScroll(page);

    // refresh cookie ทำให้ยัง login อยู่หลังรีเฟรช
    await page.reload();
    await expect(page.getByText('รอการอนุมัติ')).toBeVisible();
  });

  test('กรอก OTP ผิดเห็นข้อความภาษาไทยพร้อมจำนวนครั้งที่เหลือ', async ({ page }) => {
    const phone = randomPhone();
    await page.goto('/login');
    await page.getByLabel('เบอร์มือถือ').fill(phone);
    await page.getByRole('button', { name: 'ขอรหัส OTP' }).click();
    const code = await readOtp(phone);

    await page.getByLabel('รหัส OTP').fill(code === '000000' ? '111111' : '000000');
    await page.getByRole('button', { name: 'ยืนยัน' }).click();

    await expect(page.getByText('รหัส OTP ไม่ถูกต้อง (กรอกได้อีก 4 ครั้ง)')).toBeVisible();
    await expect(page.getByRole('button', { name: /ขอรหัสใหม่ \(\d+\)/ })).toBeDisabled();
  });

  test('เบอร์ไม่ถูกต้องแสดงข้อผิดพลาดใต้ช่อง', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('เบอร์มือถือ').fill('021234567');
    await page.getByRole('button', { name: 'ขอรหัส OTP' }).click();

    await expect(page.getByText('เบอร์มือถือไม่ถูกต้อง')).toBeVisible();
  });
});

test.describe('สถานะบัญชี', () => {
  test('ถูกปฏิเสธ → เห็นเหตุผล → แก้ข้อมูล → กลับเป็นรออนุมัติ; อนุมัติแล้วเห็นสถานะใหม่', async ({
    page,
    request,
  }) => {
    const phone = randomPhone();
    await loginWithOtp(page, phone);
    await expect(page).toHaveURL(/\/register$/);
    await page.getByRole('textbox', { name: 'ชื่อ', exact: true }).fill('ปฏิเสธ');
    await page.getByLabel('นามสกุล').fill('ทดสอบ');
    await page.getByLabel('ที่อยู่').fill('ที่อยู่สั้นไป');
    await page.getByLabel(/ฉันยินยอมให้เก็บและใช้ข้อมูลส่วนบุคคล/).check();
    await page.getByRole('button', { name: 'สมัครสมาชิก' }).click();
    await expect(page.getByText('รอการอนุมัติ')).toBeVisible();

    const admin = await adminRequest(request);
    await admin.reject(phone, 'ที่อยู่ไม่ครบ กรุณาระบุเลขที่และเขต');
    await page.reload();

    await expect(page.getByText('ไม่ผ่านการอนุมัติ')).toBeVisible();
    await expect(page.getByText('เหตุผล: ที่อยู่ไม่ครบ กรุณาระบุเลขที่และเขต')).toBeVisible();

    await page.getByRole('link', { name: 'แก้ไขข้อมูลและส่งใหม่' }).click();
    await page.getByLabel('ที่อยู่').fill('99/1 ถนนลาดพร้าว เขตวังทองหลาง กรุงเทพฯ');
    await page.getByRole('button', { name: 'บันทึกและส่งตรวจใหม่' }).click();
    await expect(page.getByText('ส่งข้อมูลให้เจ้าหน้าที่ตรวจสอบใหม่แล้ว')).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.getByRole('link', { name: 'กลับหน้าหลัก' }).click();
    await expect(page.getByText('รอการอนุมัติ')).toBeVisible();

    await admin.approve(phone);
    await page.reload();
    await expect(page.getByText('บัญชีได้รับการอนุมัติแล้ว')).toBeVisible();
  });

  test('ออกจากระบบแล้วกลับไปหน้าแรกต้อง login ใหม่', async ({ page }) => {
    const phone = randomPhone();
    await loginWithOtp(page, phone);
    await expect(page).toHaveURL(/\/register$/);
    await page.getByRole('textbox', { name: 'ชื่อ', exact: true }).fill('ออก');
    await page.getByLabel('นามสกุล').fill('ระบบ');
    await page.getByLabel('ที่อยู่').fill('1 ถนนทดสอบ กรุงเทพฯ');
    await page.getByLabel(/ฉันยินยอมให้เก็บและใช้ข้อมูลส่วนบุคคล/).check();
    await page.getByRole('button', { name: 'สมัครสมาชิก' }).click();
    await expect(page.getByText('รอการอนุมัติ')).toBeVisible();

    await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });
});
