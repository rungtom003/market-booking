import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import Redis from 'ioredis';
import { E2E_REDIS_URL } from '../env';
import { loginWithOtp, randomPhone, registerVendor } from '../helpers';

test.describe('PDPA: ข้อมูลของฉัน (จอ 360px)', () => {
  test('ดาวน์โหลดข้อมูลของตัวเอง → ลบบัญชี (ยืนยันด้วยเบอร์) → ออกจากระบบ → เบอร์เดิมสมัครใหม่ได้', async ({
    page,
  }) => {
    const phone = randomPhone();
    await registerVendor(page, phone, { firstName: 'ขอลบ', lastName: 'ข้อมูล' });
    await page.goto('/profile');

    // สำเนาข้อมูล (JSON)
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'ดาวน์โหลดข้อมูลของฉัน (JSON)' }).click();
    const file = await downloading;
    expect(file.suggestedFilename()).toMatch(/^ข้อมูลของฉัน-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(await readFile((await file.path())!, 'utf8'));
    expect(data.profile).toMatchObject({ firstName: 'ขอลบ', lastName: 'ข้อมูล', phone });
    expect(data.bookings).toEqual([]);

    // ลบบัญชี: เบอร์ไม่ตรง → แจ้งที่ช่อง
    await page.getByRole('button', { name: 'ลบบัญชีและข้อมูลของฉัน' }).click();
    const confirm = page.getByLabel('พิมพ์เบอร์มือถือของบัญชีนี้เพื่อยืนยัน');
    await confirm.fill('0800000000');
    await page.getByRole('button', { name: 'ยืนยันลบบัญชี' }).click();
    await expect(page.getByText('เบอร์โทรไม่ตรงกับบัญชีนี้')).toBeVisible();
    await confirm.fill(phone);
    await page.getByRole('button', { name: 'ยืนยันลบบัญชี' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('ลบบัญชีและข้อมูลส่วนบุคคลของคุณแล้ว')).toBeVisible();

    // ออกจากระบบแล้วจริง (refresh cookie ถูกลบ) และเบอร์เดิมเริ่มสมัครใหม่ได้
    await page.goto('/profile');
    await expect(page).toHaveURL(/\/login/);
    // ข้าม cooldown ขอ OTP ซ้ำ 60 วินาที (เพิ่งขอตอนสมัคร) — แทนการรอจริง
    const redis = new Redis(E2E_REDIS_URL);
    await redis.del(`otp:cd:${phone}`);
    redis.disconnect();
    await loginWithOtp(page, phone);
    await expect(page).toHaveURL(/\/register$/);
  });
});
