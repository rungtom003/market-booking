import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { UploadTicket } from '@market-booking/shared';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { AdminPrincipal } from '../../src/modules/auth/principal';
import { RegistrationTokenService } from '../../src/modules/auth/registration-token.service';
import { TokenService } from '../../src/modules/auth/token.service';
import { NotifyService } from '../../src/modules/notify/notify.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { StorageService } from '../../src/modules/storage/storage.service';
import { RequireApprovedVendor } from '../../src/modules/vendor/vendor-approved.guard';
import { VendorModule } from '../../src/modules/vendor/vendor.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupApp } from '../../src/setup-app';
import { testRedisUrl } from './test-db-url';
import { truncateAll } from './test-db';

/** endpoint สมมติที่ต้องเป็นผู้ค้าที่อนุมัติแล้ว (เหมือนการจองใน Phase 4) */
@Controller('probe-approved')
class ApprovedOnlyController {
  @RequireApprovedVendor()
  @Get()
  ok() {
    return { ok: true };
  }
}

// ไฟล์รูปเล็กๆ ที่ขึ้นต้นด้วย magic bytes ถูกต้อง (พอสำหรับการตรวจของ server)
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(120, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(120, 2)]);
const NOT_AN_IMAGE = Buffer.from('<?php echo "not an image"; ?>'.padEnd(128, ' '));

const BASE_PROFILE = {
  firstName: 'สมหญิง',
  lastName: 'ขายดี',
  address: '99 ถนนตลาด กรุงเทพฯ',
  pdpaConsent: true,
};

describe('Vendors: register, profile, approval (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let settings: SettingsService;
  let marketId: string;
  let otherMarketId: string;
  let categoryId: string;
  let admin: AdminPrincipal;
  let staff: AdminPrincipal;
  let finance: AdminPrincipal;
  let otherMarketAdmin: AdminPrincipal;
  let phoneSeq = 0;
  const notified = jest.fn();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, VendorModule],
      controllers: [ApprovedOnlyController],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    settings = app.get(SettingsService);
    redis = new Redis(testRedisUrl());
    jest.spyOn(app.get(NotifyService), 'vendorStatusChanged').mockImplementation(notified);

    await truncateAll(prisma as unknown as PrismaClient);
    marketId = (await prisma.market.create({ data: { name: 'ตลาดหลัก', address: '-' } })).id;
    // createdAt ทีหลัง → ไม่ใช่ตลาดหลัก
    otherMarketId = (await prisma.market.create({ data: { name: 'ตลาดอื่น', address: '-' } })).id;
    categoryId = (await prisma.productCategory.create({ data: { marketId, name: 'อาหาร' } })).id;

    const makeAdmin = async (
      username: string,
      role: AdminPrincipal['role'],
      mkt: string | null = marketId,
    ): Promise<AdminPrincipal> => {
      const row = await prisma.adminUser.create({
        data: { username, passwordHash: 'x', displayName: username, role, marketId: mkt },
      });
      return { actorType: 'ADMIN', id: row.id, role, marketId: mkt };
    };
    admin = await makeAdmin('admin', 'ADMIN');
    staff = await makeAdmin('staff', 'STAFF');
    finance = await makeAdmin('finance', 'FINANCE');
    otherMarketAdmin = await makeAdmin('other', 'ADMIN', otherMarketId);
  });

  beforeEach(async () => {
    await redis.flushdb();
    notified.mockClear();
  });

  afterAll(async () => {
    redis.disconnect();
    await app.close();
  });

  // ───────────── helpers ─────────────

  const nextPhone = () => `08${String(10000000 + ++phoneSeq).slice(-8)}`;
  const bearer = (p: AdminPrincipal) => `Bearer ${app.get(TokenService).signAccessToken(p)}`;
  const vendorBearer = (id: string) =>
    `Bearer ${app.get(TokenService).signAccessToken({ actorType: 'VENDOR', id, marketId })}`;

  function otpToken(phone = nextPhone()) {
    return {
      phone,
      token: app.get(RegistrationTokenService).sign({ marketId, verifiedPhone: phone }),
    };
  }

  async function putFile(ticket: UploadTicket, body: Buffer) {
    return fetch(ticket.url, { method: 'PUT', headers: ticket.headers, body });
  }

  async function uploadForRegistration(
    registrationToken: string,
    kind: 'ID_CARD' | 'SHOP',
    body: Buffer,
    contentType = 'image/png',
  ): Promise<string> {
    const res = await http()
      .post('/api/v1/vendors/register/uploads')
      .send({ registrationToken, kind, contentType, size: body.length })
      .expect(201);
    const put = await putFile(res.body.data, body);
    expect(put.status).toBe(200);
    return res.body.data.key;
  }

  async function register(extra: Record<string, unknown> = {}, token = otpToken()) {
    const res = await http()
      .post('/api/v1/vendors/register')
      .send({ ...BASE_PROFILE, registrationToken: token.token, ...extra });
    return { res, phone: token.phone, id: res.body.data?.vendor?.id as string };
  }

  async function setStatus(
    id: string,
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED',
    data = {},
  ) {
    await prisma.vendor.update({ where: { id }, data: { status, ...data } });
  }

  // ───────────── register ─────────────

  describe('POST /vendors/register', () => {
    it('MANUAL mode → PENDING, logged in, verified phone taken from the token', async () => {
      const { res, phone, id } = await register({ phone: '0899999999' }); // เบอร์ใน body ถูกเมิน

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        status: 'LOGGED_IN',
        expiresIn: 900,
        vendor: { phone, status: 'PENDING' },
      });
      expect(String(res.headers['set-cookie'])).toContain('mb_vendor_rt=');

      const row = await prisma.vendor.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ status: 'PENDING', phone, reviewedAt: null });
      expect(row.phoneVerifiedAt).not.toBeNull();
      expect(row.pdpaConsentAt).not.toBeNull();
      await expect(
        prisma.auditLog.count({ where: { action: 'vendor.register', entityId: id } }),
      ).resolves.toBe(1);
      expect(notified).toHaveBeenCalledWith(
        expect.objectContaining({ vendorId: id, from: null, to: 'PENDING' }),
      );
    });

    it('AUTO mode → APPROVED immediately', async () => {
      await settings.update(admin, marketId, { registration_mode: 'AUTO' });
      try {
        const { res, id } = await register();

        expect(res.body.data.vendor.status).toBe('APPROVED');
        const row = await prisma.vendor.findUniqueOrThrow({ where: { id } });
        expect(row.reviewedAt).not.toBeNull();
        expect(row.reviewedById).toBeNull(); // อนุมัติโดยระบบ
      } finally {
        await settings.update(admin, marketId, { registration_mode: 'MANUAL' });
      }
    });

    it('switching to AUTO does not approve vendors who are already PENDING', async () => {
      const { id } = await register();

      await settings.update(admin, marketId, { registration_mode: 'AUTO' });
      try {
        const row = await prisma.vendor.findUniqueOrThrow({ where: { id } });
        expect(row.status).toBe('PENDING');
      } finally {
        await settings.update(admin, marketId, { registration_mode: 'MANUAL' });
      }
    });

    it('requires PDPA consent', async () => {
      const { res } = await register({ pdpaConsent: false });

      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain('pdpaConsent');
    });

    it('cannot register the same verified phone twice', async () => {
      const token = otpToken();
      expect((await register({}, token)).res.status).toBe(201);

      const again = await register({}, token);
      expect(again.res.status).toBe(409);
      expect(again.res.body.error.code).toBe('PHONE_ALREADY_REGISTERED');
    });

    it('LINE path: phone from the form (unverified) and LINE linked', async () => {
      const lineOnly = app.get(RegistrationTokenService).sign({ marketId, lineUserId: 'U-line-1' });
      const phone = nextPhone();

      const missing = await register({}, { phone: '', token: lineOnly });
      expect(missing.res.status).toBe(400);
      expect(missing.res.body.error.details[0].path).toBe('phone');

      const { res, id } = await register({ phone }, { phone, token: lineOnly });
      expect(res.status).toBe(201);
      expect(res.body.data.vendor).toMatchObject({ phone, lineLinked: true });
      const row = await prisma.vendor.findUniqueOrThrow({ where: { id } });
      expect(row.phoneVerifiedAt).toBeNull();
    });

    it('LINE path with a phone that already has an account → PHONE_ALREADY_REGISTERED', async () => {
      const { phone } = await register();
      const lineOnly = app.get(RegistrationTokenService).sign({ marketId, lineUserId: 'U-line-2' });

      const { res } = await register({ phone }, { phone, token: lineOnly });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PHONE_ALREADY_REGISTERED');
    });

    it('rejects an unknown product category and an invalid token', async () => {
      const bad = await register({ productCategoryId: '01a18fcf-0000-7000-8000-000000000000' });
      expect(bad.res.status).toBe(400);
      expect(bad.res.body.error.details[0].path).toBe('productCategoryId');

      const ok = await register({ productCategoryId: categoryId });
      expect(ok.res.status).toBe(201);

      const res = await http()
        .post('/api/v1/vendors/register')
        .send({ ...BASE_PROFILE, registrationToken: 'forged' });
      expect(res.status).toBe(401);
    });
  });

  // ───────────── images ─────────────

  describe('image upload', () => {
    afterEach(async () => {
      await settings.update(admin, marketId, { require_id_card_image: false });
    });

    it('requires the ID card image when the setting is on, and accepts an uploaded one', async () => {
      await settings.update(admin, marketId, { require_id_card_image: true });
      const token = otpToken();

      const missing = await register({}, token);
      expect(missing.res.status).toBe(400);
      expect(missing.res.body.error.details[0].path).toBe('idCardImageKey');

      const key = await uploadForRegistration(token.token, 'ID_CARD', JPEG, 'image/jpeg');
      expect(key).toMatch(/^vendors\/reg-[0-9a-f-]{36}\/id-card\/[0-9a-f-]{36}\.jpg$/);
      const { res, id } = await register({ idCardImageKey: key }, token);
      expect(res.status).toBe(201);

      // ผู้ค้าเปิดดูรูปตัวเองได้ผ่าน presigned URL
      const me = await http()
        .get('/api/v1/vendors/me')
        .set('Authorization', vendorBearer(id))
        .expect(200);
      const image = await fetch(me.body.data.idCardImageUrl);
      expect(image.status).toBe(200);
      expect(Buffer.from(await image.arrayBuffer()).equals(JPEG)).toBe(true);
    });

    it("refuses another registration's file", async () => {
      const someoneElse = otpToken();
      const key = await uploadForRegistration(someoneElse.token, 'ID_CARD', PNG);

      const { res } = await register({ idCardImageKey: key });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: 'UPLOAD_INVALID',
        details: { field: 'idCardImageKey' },
      });
    });

    it('refuses a key that was never uploaded or is the wrong kind', async () => {
      const token = otpToken();
      const ticket = await http()
        .post('/api/v1/vendors/register/uploads')
        .send({
          registrationToken: token.token,
          kind: 'SHOP',
          contentType: 'image/png',
          size: PNG.length,
        })
        .expect(201);

      const notUploaded = await register({ shopImageKey: ticket.body.data.key }, token);
      expect(notUploaded.res.body.error.code).toBe('UPLOAD_INVALID');

      await putFile(ticket.body.data, PNG);
      const wrongKind = await register({ idCardImageKey: ticket.body.data.key }, token);
      expect(wrongKind.res.body.error.code).toBe('UPLOAD_INVALID');
    });

    it('rejects and deletes a file that is not really an image', async () => {
      const token = otpToken();
      const key = await uploadForRegistration(token.token, 'SHOP', NOT_AN_IMAGE, 'image/png');

      const { res } = await register({ shopImageKey: key }, token);
      expect(res.body.error.code).toBe('UPLOAD_INVALID');
      await expect(app.get(StorageService).stat(key)).resolves.toBeNull();
    });

    it('the signed URL only accepts the declared size and type', async () => {
      const token = otpToken();
      const ticket = (
        await http()
          .post('/api/v1/vendors/register/uploads')
          .send({
            registrationToken: token.token,
            kind: 'SHOP',
            contentType: 'image/png',
            size: PNG.length,
          })
          .expect(201)
      ).body.data as UploadTicket;

      const bigger = await putFile(ticket, Buffer.concat([PNG, Buffer.alloc(1000)]));
      expect(bigger.ok).toBe(false);
      const otherType = await fetch(ticket.url, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html' },
        body: PNG,
      });
      expect(otherType.ok).toBe(false);
    });

    it('refuses upload requests over 5 MB or of other types', async () => {
      const { token } = otpToken();
      const tooBig = await http()
        .post('/api/v1/vendors/register/uploads')
        .send({
          registrationToken: token,
          kind: 'SHOP',
          contentType: 'image/png',
          size: 5 * 1024 * 1024 + 1,
        })
        .expect(400);
      expect(tooBig.body.error.details[0].path).toBe('size');

      await http()
        .post('/api/v1/vendors/register/uploads')
        .send({ registrationToken: token, kind: 'SHOP', contentType: 'application/pdf', size: 100 })
        .expect(400);
    });
  });

  // ───────────── /vendors/me ─────────────

  describe('GET/PATCH /vendors/me', () => {
    it('returns the profile without leaking the LINE id', async () => {
      const { id, phone } = await register({
        shopName: 'ร้านอร่อย',
        productCategoryId: categoryId,
      });

      const res = await http()
        .get('/api/v1/vendors/me')
        .set('Authorization', vendorBearer(id))
        .expect(200);
      expect(res.body.data).toMatchObject({
        id,
        phone,
        phoneVerified: true,
        shopName: 'ร้านอร่อย',
        productCategory: { id: categoryId, name: 'อาหาร' },
        status: 'PENDING',
        idCardImageUrl: null,
      });
      expect(res.body.data).not.toHaveProperty('lineUserId');
    });

    it('editing a REJECTED profile sends it back to PENDING and clears the reason', async () => {
      const { id } = await register();
      await setStatus(id, 'REJECTED', { rejectReason: 'ที่อยู่ไม่ครบ' });

      const res = await http()
        .patch('/api/v1/vendors/me')
        .set('Authorization', vendorBearer(id))
        .send({ address: '100 ถนนตลาด แขวงสวนหลวง กรุงเทพฯ' })
        .expect(200);

      expect(res.body.data).toMatchObject({ status: 'PENDING', rejectReason: null });
      await expect(
        prisma.auditLog.count({ where: { action: 'vendor.resubmit', entityId: id } }),
      ).resolves.toBe(1);
    });

    it('editing a PENDING profile keeps it PENDING', async () => {
      const { id } = await register();

      const res = await http()
        .patch('/api/v1/vendors/me')
        .set('Authorization', vendorBearer(id))
        .send({ shopName: 'ร้านใหม่' })
        .expect(200);
      expect(res.body.data).toMatchObject({ status: 'PENDING', shopName: 'ร้านใหม่' });
    });

    it('accepts own new images and refuses other people’s', async () => {
      const { id } = await register();
      const { id: otherId } = await register();

      const ticket = await http()
        .post('/api/v1/vendors/me/images')
        .set('Authorization', vendorBearer(id))
        .send({ kind: 'SHOP', contentType: 'image/png', size: PNG.length })
        .expect(201);
      await putFile(ticket.body.data, PNG);

      await http()
        .patch('/api/v1/vendors/me')
        .set('Authorization', vendorBearer(id))
        .send({ shopImageKey: ticket.body.data.key })
        .expect(200);
      const steal = await http()
        .patch('/api/v1/vendors/me')
        .set('Authorization', vendorBearer(otherId))
        .send({ shopImageKey: ticket.body.data.key })
        .expect(400);
      expect(steal.body.error.code).toBe('UPLOAD_INVALID');
    });

    it('does not allow changing phone or status', async () => {
      const { id } = await register();

      await http()
        .patch('/api/v1/vendors/me')
        .set('Authorization', vendorBearer(id))
        .send({ status: 'APPROVED' })
        .expect(400);
      await http()
        .patch('/api/v1/vendors/me')
        .set('Authorization', vendorBearer(id))
        .send({ phone: '0811111111' })
        .expect(400);
    });

    it('is for vendors only', async () => {
      await http().get('/api/v1/vendors/me').set('Authorization', bearer(admin)).expect(403);
      await http().get('/api/v1/vendors/me').expect(401);
    });
  });

  // ───────────── admin ─────────────

  describe('admin review', () => {
    const post = (path: string, who: AdminPrincipal, body?: object) =>
      http().post(`/api/v1/admin/vendors${path}`).set('Authorization', bearer(who)).send(body);

    it('approves a PENDING vendor and records who did it', async () => {
      const { id } = await register();

      const res = await post(`/${id}/approve`, staff).expect(200);

      expect(res.body.data).toMatchObject({
        status: 'APPROVED',
        reviewedBy: { id: staff.id, displayName: 'staff' },
      });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'vendor.approve', entityId: id },
      });
      expect(audit).toMatchObject({
        actorId: staff.id,
        before: { status: 'PENDING' },
        after: { status: 'APPROVED' },
      });
      expect(notified).toHaveBeenCalledWith(
        expect.objectContaining({ vendorId: id, from: 'PENDING', to: 'APPROVED' }),
      );
    });

    it('approving an already APPROVED vendor → INVALID_STATE_TRANSITION', async () => {
      const { id } = await register();
      await post(`/${id}/approve`, admin).expect(200);

      const res = await post(`/${id}/approve`, admin).expect(409);
      expect(res.body.error).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        details: { from: 'APPROVED', action: 'approve' },
      });
    });

    it('two admins approving at the same moment → exactly one succeeds', async () => {
      const { id } = await register();

      const results = await Promise.all([
        post(`/${id}/approve`, admin),
        post(`/${id}/approve`, staff),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      await expect(
        prisma.auditLog.count({ where: { action: 'vendor.approve', entityId: id } }),
      ).resolves.toBe(1);
    });

    it('rejects with a required reason', async () => {
      const { id } = await register();

      await post(`/${id}/reject`, admin, {}).expect(400);
      const res = await post(`/${id}/reject`, admin, { reason: 'รูปบัตรไม่ชัด' }).expect(200);
      expect(res.body.data).toMatchObject({ status: 'REJECTED', rejectReason: 'รูปบัตรไม่ชัด' });
    });

    it('suspends until a future date, then unsuspends', async () => {
      const { id } = await register();
      await post(`/${id}/approve`, admin).expect(200);

      await post(`/${id}/suspend`, admin, { until: '2020-01-01T00:00:00Z' }).expect(400);
      const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const suspended = await post(`/${id}/suspend`, admin, { until, reason: 'ไม่มาขาย' }).expect(
        200,
      );
      expect(suspended.body.data).toMatchObject({ status: 'SUSPENDED', suspendedUntil: until });

      const back = await post(`/${id}/unsuspend`, admin).expect(200);
      expect(back.body.data).toMatchObject({ status: 'APPROVED', suspendedUntil: null });
    });

    it('lifts an expired suspension automatically', async () => {
      const { id } = await register();
      await setStatus(id, 'SUSPENDED', { suspendedUntil: new Date(Date.now() - 1000) });

      const res = await http()
        .get(`/api/v1/admin/vendors/${id}`)
        .set('Authorization', bearer(admin))
        .expect(200);
      expect(res.body.data.status).toBe('APPROVED');
      await expect(
        prisma.auditLog.count({
          where: { action: 'vendor.suspension_expired', entityId: id, actorType: 'SYSTEM' },
        }),
      ).resolves.toBe(1);
    });

    it('bulk-approves, skipping vendors that are no longer PENDING', async () => {
      const a = await register();
      const b = await register();
      const c = await register();
      await setStatus(c.id, 'REJECTED');
      const missing = '01a18fcf-0000-7000-8000-00000000dead';

      const res = await post('/bulk-approve', admin, { ids: [a.id, b.id, c.id, missing] }).expect(
        200,
      );

      expect(res.body.data.approved.sort()).toEqual([a.id, b.id].sort());
      expect(res.body.data.skipped).toEqual(
        expect.arrayContaining([
          { id: c.id, reason: 'NOT_PENDING' },
          { id: missing, reason: 'NOT_FOUND' },
        ]),
      );
    });

    it('approves all pending vendors in one call', async () => {
      await register();
      await register();

      const res = await post('/bulk-approve', admin, { allPending: true }).expect(200);
      expect(res.body.data.approved.length).toBeGreaterThanOrEqual(2);

      const counts = await http()
        .get('/api/v1/admin/vendors/counts')
        .set('Authorization', bearer(admin))
        .expect(200);
      expect(counts.body.data.PENDING).toBe(0);

      // ต้องระบุอย่างใดอย่างหนึ่งเท่านั้น
      const someId = '01a18fcf-0000-7000-8000-000000000001';
      await post('/bulk-approve', admin, {}).expect(400);
      await post('/bulk-approve', admin, { ids: [someId], allPending: true }).expect(400);
    });

    it('lists by status (oldest pending first) and searches by name or phone', async () => {
      const first = await register({ firstName: 'ค้นหาได้' });
      const second = await register({ firstName: 'ค้นหาได้' });

      const pending = await http()
        .get('/api/v1/admin/vendors?status=PENDING&q=ค้นหาได้')
        .set('Authorization', bearer(staff))
        .expect(200);
      expect(pending.body.data.map((v: { id: string }) => v.id)).toEqual([first.id, second.id]);
      expect(pending.body.meta).toMatchObject({ total: 2, page: 1 });

      const byPhone = await http()
        .get(`/api/v1/admin/vendors?q=${first.phone.slice(0, 3)}-${first.phone.slice(3)}`)
        .set('Authorization', bearer(staff))
        .expect(200);
      expect(byPhone.body.data.map((v: { id: string }) => v.id)).toContain(first.id);
    });

    it('FINANCE cannot review vendors; other markets cannot see them', async () => {
      const { id } = await register();

      await http().get('/api/v1/admin/vendors').set('Authorization', bearer(finance)).expect(403);
      await post(`/${id}/approve`, otherMarketAdmin).expect(404);
      await http()
        .get(`/api/v1/admin/vendors/${id}`)
        .set('Authorization', bearer(otherMarketAdmin))
        .expect(404);
    });

    it('shows ID card images to admins via short-lived URLs', async () => {
      const token = otpToken();
      const key = await uploadForRegistration(token.token, 'ID_CARD', PNG);
      const { id } = await register({ idCardImageKey: key }, token);

      const res = await http()
        .get(`/api/v1/admin/vendors/${id}`)
        .set('Authorization', bearer(admin))
        .expect(200);
      expect(res.body.data.idCardImageUrl).toContain('X-Amz-Expires=300');
      expect((await fetch(res.body.data.idCardImageUrl)).status).toBe(200);
    });
  });

  // ───────────── guard ─────────────

  describe('VendorApprovedGuard', () => {
    const probe = (id: string) =>
      http().get('/api/v1/probe-approved').set('Authorization', vendorBearer(id));

    it.each([
      ['PENDING', 'VENDOR_NOT_APPROVED'],
      ['REJECTED', 'VENDOR_NOT_APPROVED'],
    ] as const)('%s → 403 %s', async (status, code) => {
      const { id } = await register();
      await setStatus(id, status);

      const res = await probe(id).expect(403);
      expect(res.body.error.code).toBe(code);
    });

    it('SUSPENDED → 403 VENDOR_SUSPENDED with the end date', async () => {
      const { id } = await register();
      const until = new Date(Date.now() + 86_400_000);
      await setStatus(id, 'SUSPENDED', { suspendedUntil: until });

      const res = await probe(id).expect(403);
      expect(res.body.error).toMatchObject({
        code: 'VENDOR_SUSPENDED',
        details: { until: until.toISOString() },
      });
    });

    it('APPROVED (or suspension expired) → allowed', async () => {
      const { id } = await register();
      await setStatus(id, 'APPROVED');
      await probe(id).expect(200);

      await setStatus(id, 'SUSPENDED', { suspendedUntil: new Date(Date.now() - 1000) });
      await probe(id).expect(200);
    });

    it('takes effect immediately after an admin approves (no new login needed)', async () => {
      const { id } = await register();
      await probe(id).expect(403);

      await http()
        .post(`/api/v1/admin/vendors/${id}/approve`)
        .set('Authorization', bearer(admin))
        .expect(200);
      await probe(id).expect(200);
    });

    it('admins cannot use vendor-only endpoints', async () => {
      await http().get('/api/v1/probe-approved').set('Authorization', bearer(admin)).expect(403);
    });
  });
});
