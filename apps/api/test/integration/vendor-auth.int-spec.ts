import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ErrorCode } from '@market-booking/shared';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AppException } from '../../src/common/exceptions/app.exception';
import type { PrismaClient } from '../../src/generated/prisma/client';
import {
  LINE_ID_TOKEN_VERIFIER,
  LineIdTokenVerifier,
} from '../../src/modules/auth/line/line-id-token.verifier';
import { RegistrationTokenService } from '../../src/modules/auth/registration-token.service';
import { TokenService } from '../../src/modules/auth/token.service';
import { MockSmsProvider } from '../../src/modules/notify/sms/mock-sms.provider';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupApp } from '../../src/setup-app';
import { testRedisUrl } from './test-db-url';
import { truncateAll } from './test-db';

/** LINE จำลอง: token `line:<userId>:<ชื่อ>` = ถูกต้อง, อย่างอื่น = ผิด */
const fakeLine: LineIdTokenVerifier = {
  async verify(idToken) {
    const [prefix, userId, displayName] = idToken.split(':');
    if (prefix !== 'line' || !userId) {
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Invalid or expired LINE token');
    }
    return { userId, displayName };
  },
};

const NEW_PHONE = '0890000001';
const EXISTING_PHONE = '0890000002';

describe('Vendor auth: OTP + LINE (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let sms: MockSmsProvider;
  let marketId: string;
  let existingVendorId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LINE_ID_TOKEN_VERIFIER)
      .useValue(fakeLine)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    sms = app.get(MockSmsProvider);
    redis = new Redis(testRedisUrl());

    await truncateAll(prisma as unknown as PrismaClient);
    marketId = (await prisma.market.create({ data: { name: 'ตลาดทดสอบ', address: '-' } })).id;
    existingVendorId = (
      await prisma.vendor.create({
        data: {
          marketId,
          firstName: 'สมศรี',
          lastName: 'มีของขาย',
          phone: EXISTING_PHONE,
          address: '-',
          pdpaConsentAt: new Date(),
          status: 'APPROVED',
        },
      })
    ).id;
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    redis.disconnect();
    await app.close();
  });

  const requestOtp = (phone: string) => http().post('/api/v1/auth/otp/request').send({ phone });
  const verifyOtp = (phone: string, code: string, registrationToken?: string) =>
    http().post('/api/v1/auth/otp/verify').send({ phone, code, registrationToken });

  /** ขอ OTP แล้วอ่านรหัสจาก SMS จำลอง */
  async function sendOtp(phone: string): Promise<string> {
    await requestOtp(phone).expect(200);
    const code = sms.lastTo(phone)?.text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error('OTP SMS not sent');
    return code;
  }

  const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');

  const vendorCookie = (res: request.Response) =>
    ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('mb_vendor_rt='))
      ?.split(';')[0];

  describe('OTP request', () => {
    it('sends a 6-digit code by SMS and stores only a hash', async () => {
      const res = await requestOtp('+66890000001').expect(200);

      expect(res.body.data).toEqual({ expiresIn: 300, resendAfter: 60 });
      const code = sms.lastTo(NEW_PHONE)?.text.match(/\b(\d{6})\b/)?.[1];
      expect(code).toMatch(/^\d{6}$/);

      const stored = await redis.get(`otp:code:${NEW_PHONE}`);
      expect(stored).toMatch(/^[0-9a-f]{64}$/);
      expect(stored).not.toContain(code);
    });

    it('allows a new request only after 60 seconds', async () => {
      await requestOtp(NEW_PHONE).expect(200);

      const res = await requestOtp(NEW_PHONE).expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(res.body.error.details.retryAfterSeconds).toBeGreaterThan(50);
      expect(res.body.error.details.retryAfterSeconds).toBeLessThanOrEqual(60);
    });

    it('allows at most 5 requests per hour per phone', async () => {
      for (let i = 0; i < 5; i++) {
        await requestOtp(NEW_PHONE).expect(200);
        await redis.del(`otp:cd:${NEW_PHONE}`); // ข้าม cooldown 60 วินาที
      }

      const res = await requestOtp(NEW_PHONE).expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(res.body.error.details.retryAfterSeconds).toBeGreaterThan(3000);
    });

    it('rejects invalid phone numbers', async () => {
      const res = await requestOtp('021234567').expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].path).toBe('phone');
    });

    it('does not count a request when the SMS cannot be sent', async () => {
      jest
        .spyOn(sms, 'send')
        .mockRejectedValueOnce(new AppException(ErrorCode.SERVICE_UNAVAILABLE, 'SMS down'));

      const failed = await requestOtp(NEW_PHONE).expect(503);
      expect(failed.body.error.code).toBe('SERVICE_UNAVAILABLE');

      // ไม่ติด cooldown — ลองใหม่ได้ทันที
      await requestOtp(NEW_PHONE).expect(200);
    });
  });

  describe('OTP verify', () => {
    it('new phone → REGISTRATION_REQUIRED with a token that proves the verified phone', async () => {
      const code = await sendOtp(NEW_PHONE);

      const res = await verifyOtp(NEW_PHONE, code).expect(200);

      expect(res.body.data).toMatchObject({
        status: 'REGISTRATION_REQUIRED',
        expiresIn: 1800,
        prefill: { phone: NEW_PHONE },
      });
      expect(vendorCookie(res)).toBeUndefined();
      const claims = app.get(RegistrationTokenService).verify(res.body.data.registrationToken);
      expect(claims).toMatchObject({ marketId, verifiedPhone: NEW_PHONE });
    });

    it('existing vendor → LOGGED_IN with access token and vendor refresh cookie', async () => {
      const code = await sendOtp(EXISTING_PHONE);

      const res = await verifyOtp('089-000-0002', code).expect(200);

      expect(res.body.data).toMatchObject({
        status: 'LOGGED_IN',
        expiresIn: 900,
        vendor: {
          id: existingVendorId,
          phone: EXISTING_PHONE,
          status: 'APPROVED',
          lineLinked: false,
        },
      });
      const principal = app.get(TokenService).verifyAccessToken(res.body.data.accessToken);
      expect(principal).toEqual({ actorType: 'VENDOR', id: existingVendorId, marketId });

      const cookie = vendorCookie(res);
      expect(cookie).toBeDefined();
      await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie!)
        .send({ actorType: 'VENDOR' })
        .expect(200);

      const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: existingVendorId } });
      expect(vendor.phoneVerifiedAt).not.toBeNull();
    });

    it('a code can be used only once', async () => {
      const code = await sendOtp(EXISTING_PHONE);
      await verifyOtp(EXISTING_PHONE, code).expect(200);

      const reuse = await verifyOtp(EXISTING_PHONE, code).expect(400);
      expect(reuse.body.error.code).toBe('OTP_EXPIRED');
    });

    it('wrong code → OTP_INVALID with attempts left', async () => {
      const code = await sendOtp(NEW_PHONE);

      const res = await verifyOtp(NEW_PHONE, wrongCode(code)).expect(400);
      expect(res.body.error).toMatchObject({ code: 'OTP_INVALID', details: { attemptsLeft: 4 } });
    });

    it('cancels the code after 5 wrong attempts (the right code no longer works)', async () => {
      const code = await sendOtp(NEW_PHONE);
      for (let left = 4; left >= 0; left--) {
        const res = await verifyOtp(NEW_PHONE, wrongCode(code)).expect(400);
        expect(res.body.error.details.attemptsLeft).toBe(left);
      }

      const res = await verifyOtp(NEW_PHONE, code).expect(400);
      expect(res.body.error.code).toBe('OTP_EXPIRED');
    });

    it('expired code → OTP_EXPIRED', async () => {
      const code = await sendOtp(NEW_PHONE);
      await redis.pexpire(`otp:code:${NEW_PHONE}`, 1);
      await new Promise((r) => setTimeout(r, 20));

      const res = await verifyOtp(NEW_PHONE, code).expect(400);
      expect(res.body.error.code).toBe('OTP_EXPIRED');
    });

    it('never requested → OTP_EXPIRED', async () => {
      const res = await verifyOtp('0890000099', '123456').expect(400);

      expect(res.body.error.code).toBe('OTP_EXPIRED');
    });

    it('a new request replaces the previous code', async () => {
      const first = await sendOtp(NEW_PHONE);
      await redis.del(`otp:cd:${NEW_PHONE}`);
      const second = await sendOtp(NEW_PHONE);

      if (first !== second) await verifyOtp(NEW_PHONE, first).expect(400);
      await verifyOtp(NEW_PHONE, second).expect(200);
    });

    it('validates the code format', async () => {
      const res = await verifyOtp(NEW_PHONE, '12ab').expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('LINE login', () => {
    it('new LINE user → REGISTRATION_REQUIRED with LINE display name prefilled', async () => {
      const res = await http()
        .post('/api/v1/auth/line')
        .send({ idToken: 'line:U-new:สมชาย' })
        .expect(200);

      expect(res.body.data).toMatchObject({
        status: 'REGISTRATION_REQUIRED',
        prefill: { displayName: 'สมชาย' },
      });
      const claims = app.get(RegistrationTokenService).verify(res.body.data.registrationToken);
      expect(claims).toMatchObject({ lineUserId: 'U-new', verifiedPhone: undefined });
    });

    it('invalid LINE token → 401', async () => {
      const res = await http().post('/api/v1/auth/line').send({ idToken: 'forged' }).expect(401);

      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('LINE first, then OTP for a phone that already has an account → logs in and links LINE', async () => {
      const lineRes = await http()
        .post('/api/v1/auth/line')
        .send({ idToken: 'line:U-somsri:Somsri' })
        .expect(200);
      const code = await sendOtp(EXISTING_PHONE);

      const res = await verifyOtp(EXISTING_PHONE, code, lineRes.body.data.registrationToken).expect(
        200,
      );
      expect(res.body.data).toMatchObject({ status: 'LOGGED_IN', vendor: { lineLinked: true } });

      // ครั้งต่อไป login ด้วย LINE ได้ตรงๆ
      const again = await http()
        .post('/api/v1/auth/line')
        .send({ idToken: 'line:U-somsri:Somsri' })
        .expect(200);
      expect(again.body.data).toMatchObject({
        status: 'LOGGED_IN',
        vendor: { id: existingVendorId },
      });
      expect(vendorCookie(again)).toBeDefined();
    });

    it('rejects a tampered registration token without using up the OTP', async () => {
      const code = await sendOtp(NEW_PHONE);

      await verifyOtp(NEW_PHONE, code, 'tampered.token.value').expect(401);
      await verifyOtp(NEW_PHONE, code).expect(200);
    });
  });

  describe('link LINE to a logged-in vendor', () => {
    let vendorToken: string;
    let otherVendorId: string;

    beforeAll(async () => {
      otherVendorId = (
        await prisma.vendor.create({
          data: {
            marketId,
            firstName: 'ผู้ค้า',
            lastName: 'คนที่สอง',
            phone: '0890000003',
            address: '-',
            pdpaConsentAt: new Date(),
          },
        })
      ).id;
      vendorToken = app
        .get(TokenService)
        .signAccessToken({ actorType: 'VENDOR', id: otherVendorId, marketId });
    });

    it('links LINE and audits it without storing the LINE id', async () => {
      const res = await http()
        .post('/api/v1/auth/line/link')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ idToken: 'line:U-second:Second' })
        .expect(200);

      expect(res.body.data).toMatchObject({ id: otherVendorId, lineLinked: true });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'vendor.link_line', entityId: otherVendorId },
      });
      expect(JSON.stringify(audit)).not.toContain('U-second');
    });

    it('refuses a LINE account already linked to another vendor', async () => {
      await prisma.vendor.update({
        where: { id: existingVendorId },
        data: { lineUserId: 'U-somsri' },
      });

      const res = await http()
        .post('/api/v1/auth/line/link')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ idToken: 'line:U-somsri:Somsri' })
        .expect(409);

      expect(res.body.error.code).toBe('LINE_ALREADY_LINKED');
    });

    it('is only for vendors — not admins, not registration tokens', async () => {
      const adminToken = app.get(TokenService).signAccessToken({
        actorType: 'ADMIN',
        id: otherVendorId,
        role: 'SUPER_ADMIN',
        marketId: null,
      });
      const registrationToken = app
        .get(RegistrationTokenService)
        .sign({ marketId, verifiedPhone: NEW_PHONE });

      await http()
        .post('/api/v1/auth/line/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ idToken: 'line:U-x:X' })
        .expect(403);
      await http()
        .post('/api/v1/auth/line/link')
        .set('Authorization', `Bearer ${registrationToken}`)
        .send({ idToken: 'line:U-x:X' })
        .expect(401);
    });
  });
});
