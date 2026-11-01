import { type APIRequestContext, type Page, expect } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import Redis from 'ioredis';
import { API_URL, E2E_ADMIN, E2E_REDIS_URL, WEB_URL } from './env';

/** เบอร์สุ่มที่ไม่ซ้ำกับรอบก่อน (DB ของ E2E ไม่ถูกล้างระหว่างรอบ) */
export function randomPhone(): string {
  return `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
}

/** OTP ล่าสุดที่ MockSmsProvider "ส่ง" ไปเบอร์นี้ (list ใน Redis เฉพาะ dev/test — มี SMS แจ้งเตือนปนได้) */
export async function readOtp(phone: string): Promise<string> {
  const redis = new Redis(E2E_REDIS_URL);
  try {
    for (let i = 0; i < 20; i++) {
      // ใหม่สุดก่อน
      const messages = await redis.lrange(`mock-sms:outbox:${phone}`, 0, -1);
      const code = messages.map((m) => /รหัส OTP ของคุณคือ (\d{6})/.exec(m)?.[1]).find(Boolean);
      if (code) return code;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`No OTP SMS for ${phone}`);
  } finally {
    redis.disconnect();
  }
}

/** login ด้วยเบอร์ + OTP ผ่านหน้าเว็บ */
export async function loginWithOtp(page: Page, phone: string): Promise<void> {
  await page.goto(`${WEB_URL}/login`);
  await page.getByLabel('เบอร์มือถือ').fill(phone);
  await page.getByRole('button', { name: 'ขอรหัส OTP' }).click();
  await expect(page.getByLabel('รหัส OTP')).toBeVisible();
  await page.getByLabel('รหัส OTP').fill(await readOtp(phone));
  await page.getByRole('button', { name: 'ยืนยัน' }).click();
}

/** กดปุ่ม admin ผ่าน API (หน้า admin มาใน Phase 2.3) */
export async function adminRequest(request: APIRequestContext) {
  const login = await request.post(`${API_URL}/auth/admin/login`, { data: E2E_ADMIN });
  expect(login.ok()).toBeTruthy();
  const token = (await login.json()).data.accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };

  async function findVendorId(phone: string): Promise<string> {
    const res = await request.get(`${API_URL}/admin/vendors?q=${phone}`, { headers });
    const id = (await res.json()).data[0]?.id as string | undefined;
    if (!id) throw new Error(`Vendor ${phone} not found`);
    return id;
  }

  return {
    async reject(phone: string, reason: string) {
      const id = await findVendorId(phone);
      const res = await request.post(`${API_URL}/admin/vendors/${id}/reject`, {
        headers,
        data: { reason },
      });
      expect(res.ok()).toBeTruthy();
    },
    async approve(phone: string) {
      const id = await findVendorId(phone);
      const res = await request.post(`${API_URL}/admin/vendors/${id}/approve`, { headers });
      expect(res.ok()).toBeTruthy();
    },
    /** สร้างรอบ + วันขาย แล้วเผยแพร่ — คืน id รอบ (ไว้ยกเลิกตอนจบ test) และ id วันขายตามลำดับวันที่ */
    async publishRound(input: {
      name: string;
      openAt: Date;
      closeAt: Date;
      dates: string[];
      maxStallsPerVendor?: number;
    }) {
      const created = await request.post(`${API_URL}/admin/rounds`, {
        headers,
        data: {
          name: input.name,
          openAt: input.openAt.toISOString(),
          closeAt: input.closeAt.toISOString(),
          maxStallsPerVendor: input.maxStallsPerVendor,
        },
      });
      expect(created.ok()).toBeTruthy();
      const id = (await created.json()).data.id as string;
      const days = await request.post(`${API_URL}/admin/rounds/${id}/market-days`, {
        headers,
        data: { dates: input.dates },
      });
      expect(days.ok(), await days.text()).toBeTruthy();
      const dayIds = ((await days.json()).data.marketDays as { id: string }[]).map((d) => d.id);
      const published = await request.post(`${API_URL}/admin/rounds/${id}/publish`, { headers });
      expect(published.ok()).toBeTruthy();
      return { roundId: id, dayIds };
    },
    /** แก้ค่าตั้งค่าระบบบางตัว (PUT /admin/settings แบบ partial) */
    async updateSettings(input: Record<string, unknown>) {
      const res = await request.put(`${API_URL}/admin/settings`, { headers, data: input });
      expect(res.ok(), await res.text()).toBeTruthy();
    },
    vendorId: findVendorId,
    /** จองแทนผู้ค้า (ค่าเริ่มต้นรอชำระ) แล้ว (ถ้าระบุ) รับเงินสด → คืน id การจอง */
    async bookForVendor(input: {
      marketDayId: string;
      stallCode: string;
      vendorId: string;
      cash?: number;
    }) {
      const day = await request.get(`${API_URL}/admin/market-days/${input.marketDayId}/stalls`, {
        headers,
      });
      const stall = ((await day.json()).data.stalls as { id: string; code: string }[]).find(
        (s) => s.code === input.stallCode,
      );
      if (!stall) throw new Error(`Stall ${input.stallCode} not found`);
      const created = await request.post(`${API_URL}/admin/bookings`, {
        headers,
        data: {
          vendorId: input.vendorId,
          stallId: stall.id,
          marketDayId: input.marketDayId,
          status: 'PENDING_PAYMENT',
        },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const bookingId = (await created.json()).data.id as string;
      if (input.cash !== undefined) {
        const paid = await request.post(`${API_URL}/admin/payments/cash`, {
          headers,
          data: { bookingId, amount: input.cash },
        });
        expect(paid.ok(), await paid.text()).toBeTruthy();
      }
      return bookingId;
    },
    async cancelRound(id: string) {
      await request.post(`${API_URL}/admin/rounds/${id}/cancel`, { headers });
    },
  };
}

/** วันที่ (เวลาไทย) อีก `days` วันจากวันนี้ — YYYY-MM-DD */
export function bangkokDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000 + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** "1 วัน 02:03:04" / "00:00:17" → วินาที */
export function parseCountdown(text: string): number {
  const m = /(?:(\d+) วัน )?(\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (!m) throw new Error(`Not a countdown: ${text}`);
  return Number(m[1] ?? 0) * 86_400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

/** ไม่มี scroll แนวนอน (เนื้อหาไม่ล้นจอ 360px) */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** รูป PNG สีเดียวที่ถูกต้องจริง (ให้เบราว์เซอร์ decode ได้) — ไม่ต้องเก็บไฟล์รูปใน repo */
export function makePng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
  const pixels = Buffer.concat(Array(height).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * ล็อค 20 ตัวจาก seed (A1–A10 แถวบน, B1–B10 แถวล่าง) ต้องอยู่ตรงตำแหน่งบน StallMap
 * ตรวจจาก `<rect x y>` ของแต่ละล็อค (หน่วย px ของ canvas ตาม pos_x/pos_y)
 */
export async function expectSeedStallsOnMap(page: Page): Promise<void> {
  for (const [row, prefix] of ['A', 'B'].entries()) {
    for (let i = 0; i < 10; i++) {
      const rect = page.locator(`[data-stall-code="${prefix}${i + 1}"] rect`);
      await expect(rect).toHaveAttribute('x', String(20 + i * 70));
      await expect(rect).toHaveAttribute('y', String(20 + row * 120));
      await expect(rect).toHaveAttribute('width', '60');
    }
  }
}

/** สมัครผู้ค้าใหม่ผ่านหน้าเว็บผู้ค้าจนถึงหน้า "รอการอนุมัติ" */
export async function registerVendor(
  page: Page,
  phone: string,
  profile: { firstName: string; lastName: string; address?: string },
): Promise<void> {
  await loginWithOtp(page, phone);
  await expect(page).toHaveURL(/\/register$/);
  await page.getByRole('textbox', { name: 'ชื่อ', exact: true }).fill(profile.firstName);
  await page.getByLabel('นามสกุล').fill(profile.lastName);
  await page.getByLabel('ที่อยู่').fill(profile.address ?? '1 ถนนทดสอบ กรุงเทพฯ');
  await page.getByLabel(/ฉันยินยอมให้เก็บและใช้ข้อมูลส่วนบุคคล/).check();
  await page.getByRole('button', { name: 'สมัครสมาชิก' }).click();
  await expect(page.getByText('รอการอนุมัติ')).toBeVisible();
}
