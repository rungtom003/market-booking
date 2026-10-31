import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { hashPassword } from '../../src/common/password';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { TokenService } from '../../src/modules/auth/token.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupApp } from '../../src/setup-app';
import { testRedisUrl } from './test-db-url';
import { truncateAll } from './test-db';

const PASSWORD = 'correct-horse-battery';
const COOKIE = 'mb_admin_rt';

describe('Admin auth & RBAC (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let marketId: string;
  const ids: Record<string, string> = {};
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    redis = new Redis(testRedisUrl());

    await truncateAll(prisma as unknown as PrismaClient);
    marketId = (await prisma.market.create({ data: { name: 'ตลาดทดสอบ', address: '-' } })).id;
    await prisma.systemSetting.create({
      data: { marketId, key: 'registration_mode', value: 'AUTO' },
    });
    const passwordHash = await hashPassword(PASSWORD);
    for (const [username, role] of [
      ['super', 'SUPER_ADMIN'],
      ['admin', 'ADMIN'],
      ['staff', 'STAFF'],
      ['finance', 'FINANCE'],
    ] as const) {
      const row = await prisma.adminUser.create({
        data: {
          username,
          passwordHash,
          displayName: username,
          role,
          marketId: role === 'SUPER_ADMIN' ? null : marketId,
        },
      });
      ids[username] = row.id;
    }
  });

  // rate limit/การล็อค/session อยู่ใน Redis — เริ่มใหม่ทุก test
  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    redis.disconnect();
    await app.close();
  });

  function refreshCookieFrom(res: request.Response): string | undefined {
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    return cookies.find((c) => c.startsWith(`${COOKIE}=`));
  }

  const cookieValue = (setCookie: string) => setCookie.split(';')[0]!;

  async function login(username: string, password = PASSWORD) {
    const res = await http().post('/api/v1/auth/admin/login').send({ username, password });
    const setCookie = refreshCookieFrom(res);
    return {
      res,
      token: res.body.data?.accessToken as string,
      cookie: setCookie ? cookieValue(setCookie) : '',
      setCookie,
    };
  }

  const refresh = (cookie: string) =>
    http().post('/api/v1/auth/refresh').set('Cookie', cookie).send({ actorType: 'ADMIN' });

  describe('login', () => {
    it('returns an access token and profile, and sets a hardened refresh cookie', async () => {
      const { res, token, setCookie } = await login('Staff'); // username ไม่สนตัวพิมพ์

      expect(res.status).toBe(200);
      expect(token).toEqual(expect.any(String));
      expect(res.body.data).toMatchObject({
        expiresIn: 900,
        admin: { username: 'staff', role: 'STAFF', marketId },
      });
      expect(res.body.data.admin.permissions).toContain('VENDORS_REVIEW');
      expect(res.body.data.admin.permissions).not.toContain('SETTINGS_MANAGE');
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2b\$/);
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Strict/i);
      expect(setCookie).toMatch(/Path=\/api\/v1\/auth/);
    });

    it('records last login time and an audit entry', async () => {
      await login('finance');

      const row = await prisma.adminUser.findUniqueOrThrow({ where: { id: ids.finance } });
      expect(row.lastLoginAt).not.toBeNull();
      await expect(
        prisma.auditLog.count({ where: { action: 'auth.login', actorId: ids.finance } }),
      ).resolves.toBeGreaterThan(0);
    });

    it('rejects a wrong password and an unknown username with the same error', async () => {
      const wrong = await login('staff', 'wrong-password');
      const unknown = await login('nobody', 'wrong-password');

      for (const { res } of [wrong, unknown]) {
        expect(res.status).toBe(401);
        expect(res.body.error).toEqual({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid username or password',
        });
      }
    });

    it('locks the account after 5 failures, even for the right password', async () => {
      for (let i = 0; i < 5; i++) expect((await login('admin', 'nope')).res.status).toBe(401);

      const { res } = await login('admin');
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
      expect(res.body.error.details.retryAfterSeconds).toBeGreaterThan(14 * 60);
    });

    it('resets the failure count after a successful login', async () => {
      for (let i = 0; i < 4; i++) await login('admin', 'nope');
      expect((await login('admin')).res.status).toBe(200);
      for (let i = 0; i < 4; i++) await login('admin', 'nope');

      expect((await login('admin')).res.status).toBe(200);
    });

    it('validates the body', async () => {
      const res = await http().post('/api/v1/auth/admin/login').send({ username: 'admin' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('access control', () => {
    it('requires a valid bearer token', async () => {
      await http().get('/api/v1/admin/settings').expect(401);
      const res = await http()
        .get('/api/v1/admin/settings')
        .set('Authorization', 'Bearer not-a-token')
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('STAFF and FINANCE get 403 on /admin/settings; ADMIN and SUPER_ADMIN get the settings', async () => {
      for (const username of ['staff', 'finance']) {
        const { token } = await login(username);
        const res = await http()
          .get('/api/v1/admin/settings')
          .set('Authorization', `Bearer ${token}`);
        expect([username, res.status, res.body.error?.code]).toEqual([username, 403, 'FORBIDDEN']);
      }
      for (const username of ['admin', 'super']) {
        const { token } = await login(username);
        const res = await http()
          .get('/api/v1/admin/settings')
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        // ค่าจาก DB ทับ default; ค่าอื่นเป็น default
        expect(res.body.data).toMatchObject({ registration_mode: 'AUTO', hold_minutes: 10 });
      }
    });

    it('only SUPER_ADMIN can manage admin users', async () => {
      const { token: adminToken } = await login('admin');
      await http()
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);

      const { token } = await login('super');
      const res = await http()
        .get('/api/v1/admin/users?pageSize=2')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 4, totalPages: 2 });
    });

    it('GET /admin/me returns the profile with permissions', async () => {
      const { token } = await login('finance');
      const res = await http()
        .get('/api/v1/admin/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data).toMatchObject({ username: 'finance', role: 'FINANCE' });
      expect(res.body.data.permissions.sort()).toEqual(['PAYMENTS_VERIFY', 'REPORTS_VIEW']);
    });

    it('vendors cannot reach any /admin endpoint', async () => {
      const vendorToken = app
        .get(TokenService)
        .signAccessToken({ actorType: 'VENDOR', id: ids.staff!, marketId });

      const res = await http()
        .get('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${vendorToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('refresh token rotation', () => {
    it('issues a new access token and rotates the cookie', async () => {
      const { cookie } = await login('staff');

      const res = await refresh(cookie).expect(200);
      const next = refreshCookieFrom(res);

      expect(res.body.data).toMatchObject({ accessToken: expect.any(String), expiresIn: 900 });
      expect(next).toBeDefined();
      expect(cookieValue(next!)).not.toBe(cookie);
    });

    it('rejects reuse of a rotated token and revokes the whole session family', async () => {
      const { cookie } = await login('staff');
      const rotated = cookieValue(refreshCookieFrom(await refresh(cookie).expect(200))!);

      const reuse = await refresh(cookie);
      expect(reuse.status).toBe(401);
      expect(reuse.body.error.code).toBe('UNAUTHORIZED');

      // ผู้ที่ถือ token ใหม่ (อาจเป็นผู้โจมตี) ก็ใช้ไม่ได้แล้ว
      await refresh(rotated).expect(401);
    });

    it('keeps other devices signed in when one session is revoked', async () => {
      const laptop = await login('staff');
      const phone = await login('staff');

      await http()
        .post('/api/v1/auth/logout')
        .set('Cookie', laptop.cookie)
        .send({ actorType: 'ADMIN' })
        .expect(200);

      await refresh(laptop.cookie).expect(401);
      await refresh(phone.cookie).expect(200);
    });

    it('logout clears the cookie', async () => {
      const { cookie } = await login('staff');

      const res = await http()
        .post('/api/v1/auth/logout')
        .set('Cookie', cookie)
        .send({ actorType: 'ADMIN' })
        .expect(200);

      expect(res.body).toEqual({ data: null });
      expect(refreshCookieFrom(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    });

    it('does not accept an admin cookie as a vendor session', async () => {
      const { cookie } = await login('staff');
      const vendorCookie = cookie.replace(`${COOKIE}=`, 'mb_vendor_rt=');

      await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', vendorCookie)
        .send({ actorType: 'VENDOR' })
        .expect(401);
    });

    it('rejects missing or garbage cookies', async () => {
      await refresh('').expect(401);
      await refresh(`${COOKIE}=garbage`).expect(401);
      await refresh(`${COOKIE}=00000000-0000-0000-0000-000000000000.fake`).expect(401);
    });
  });

  describe('admin users CRUD (SUPER_ADMIN)', () => {
    async function superToken() {
      return (await login('super')).token;
    }

    it('creates a user (normalised username, no password in response) and audits it', async () => {
      const token = await superToken();
      const res = await http()
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username: 'New.Staff',
          password: 'a-long-password',
          displayName: 'ใหม่',
          role: 'STAFF',
        })
        .expect(201);

      expect(res.body.data).toMatchObject({
        username: 'new.staff',
        role: 'STAFF',
        marketId, // ไม่ระบุ = ตลาดหลัก
        isActive: true,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'admin_user.create', entityId: res.body.data.id },
      });
      expect(audit.actorId).toBe(ids.super);
      expect(JSON.stringify(audit.after)).not.toMatch(/passwordHash|\$2b\$/);

      // login ด้วยบัญชีใหม่ได้
      expect((await login('new.staff', 'a-long-password')).res.status).toBe(200);
    });

    it('rejects duplicate usernames and weak passwords', async () => {
      const token = await superToken();
      const dup = await http()
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${token}`)
        .send({ username: 'staff', password: 'a-long-password', displayName: 'x', role: 'STAFF' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('USERNAME_TAKEN');

      const weak = await http()
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${token}`)
        .send({ username: 'weak', password: 'short', displayName: 'x', role: 'STAFF' });
      expect(weak.status).toBe(400);
      expect(weak.body.error.details[0].path).toBe('password');
    });

    it('signs the user out everywhere when their role changes', async () => {
      const finance = await login('finance');
      const token = await superToken();

      const res = await http()
        .patch(`/api/v1/admin/users/${ids.finance}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'STAFF' })
        .expect(200);
      expect(res.body.data.role).toBe('STAFF');

      await refresh(finance.cookie).expect(401);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'admin_user.update', entityId: ids.finance },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit.before).toMatchObject({ role: 'FINANCE' });
      expect(audit.after).toMatchObject({ role: 'STAFF' });
    });

    it('deactivated users cannot log in or refresh', async () => {
      const session = await login('admin');
      const token = await superToken();

      await http()
        .patch(`/api/v1/admin/users/${ids.admin}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive: false })
        .expect(200);

      expect((await login('admin')).res.status).toBe(401);
      await refresh(session.cookie).expect(401);
    });

    it('prevents super admins from demoting or deactivating themselves', async () => {
      const token = await superToken();

      const res = await http()
        .patch(`/api/v1/admin/users/${ids.super}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive: false });
      expect(res.status).toBe(403);
    });

    it('keeps at least one active SUPER_ADMIN', async () => {
      const token = await superToken();
      const created = await http()
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username: 'super2',
          password: 'a-long-password',
          displayName: 'S2',
          role: 'SUPER_ADMIN',
        })
        .expect(201);
      expect(created.body.data.marketId).toBeNull();
      const super2Token = (await login('super2', 'a-long-password')).token;

      // super ปิด super2 ได้ (ยังมี super เหลือ)
      await http()
        .patch(`/api/v1/admin/users/${created.body.data.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive: false })
        .expect(200);

      // access token เดิมของ super2 ยังใช้ได้ ≤ 15 นาที — แต่ปิด super คนสุดท้ายไม่ได้
      const res = await http()
        .patch(`/api/v1/admin/users/${ids.super}`)
        .set('Authorization', `Bearer ${super2Token}`)
        .send({ role: 'ADMIN' });
      expect(res.status).toBe(409);
    });

    it('returns 404 for unknown ids and 400 for malformed ids', async () => {
      const token = await superToken();

      await http()
        .get('/api/v1/admin/users/01a18fcf-0000-7000-8000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      await http()
        .get('/api/v1/admin/users/not-a-uuid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
      await http()
        .get(`/api/v1/admin/users/${ids.staff}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });
});
