import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { AdminPrincipal } from '../../src/modules/auth/principal';
import { TokenService } from '../../src/modules/auth/token.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupApp } from '../../src/setup-app';
import { testRedisUrl } from './test-db-url';
import { truncateAll } from './test-db';

describe('Settings (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let settings: SettingsService;
  let marketId: string;
  let admin: AdminPrincipal;
  let staff: AdminPrincipal;
  const http = () => request(app.getHttpServer());
  const bearer = (p: AdminPrincipal) => `Bearer ${app.get(TokenService).signAccessToken(p)}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    settings = app.get(SettingsService);
    redis = new Redis(testRedisUrl());

    await truncateAll(prisma as unknown as PrismaClient);
    marketId = (await prisma.market.create({ data: { name: 'ตลาดทดสอบ', address: '-' } })).id;
    const make = async (username: string, role: 'ADMIN' | 'STAFF'): Promise<AdminPrincipal> => {
      const row = await prisma.adminUser.create({
        data: { username, passwordHash: 'x', displayName: username, role, marketId },
      });
      return { actorType: 'ADMIN', id: row.id, role, marketId };
    };
    admin = await make('admin', 'ADMIN');
    staff = await make('staff', 'STAFF');
  });

  beforeEach(async () => {
    await redis.flushdb();
    await prisma.systemSetting.deleteMany();
    await prisma.auditLog.deleteMany();
  });

  afterAll(async () => {
    redis.disconnect();
    await app.close();
  });

  describe('SettingsService', () => {
    it('returns defaults for a market that has no stored settings', async () => {
      await expect(settings.get(marketId, 'registration_mode')).resolves.toBe('MANUAL');
      await expect(settings.get(marketId, 'promptpay_id')).resolves.toBeNull();
    });

    it('serves reads from the Redis cache', async () => {
      await settings.get(marketId, 'hold_minutes');
      // เปลี่ยนใน DB ตรงๆ (ไม่ผ่าน service) — ยังได้ค่าเดิมจาก cache
      await prisma.systemSetting.create({ data: { marketId, key: 'hold_minutes', value: 25 } });

      await expect(settings.get(marketId, 'hold_minutes')).resolves.toBe(10);
    });

    it('returns the new registration_mode immediately after an update (cache invalidated)', async () => {
      await expect(settings.get(marketId, 'registration_mode')).resolves.toBe('MANUAL'); // cache ค่าเดิม

      await settings.update(admin, marketId, { registration_mode: 'AUTO' });

      await expect(settings.get(marketId, 'registration_mode')).resolves.toBe('AUTO');
      // และเก็บลง DB จริง พร้อมผู้แก้
      const row = await prisma.systemSetting.findUniqueOrThrow({
        where: { marketId_key: { marketId, key: 'registration_mode' } },
      });
      expect(row).toMatchObject({ value: 'AUTO', updatedById: admin.id });
    });

    it('audits only the keys that actually changed', async () => {
      await settings.update(admin, marketId, { hold_minutes: 15, payment_required: true });

      const logs = await prisma.auditLog.findMany({ where: { action: 'settings.update' } });
      expect(logs).toHaveLength(1);
      // payment_required = true อยู่แล้ว (default) จึงไม่ถือว่าเปลี่ยน
      expect(logs[0]).toMatchObject({
        actorId: admin.id,
        entityType: 'market',
        entityId: marketId,
        before: { hold_minutes: 10 },
        after: { hold_minutes: 15 },
      });
    });

    it('writes nothing for a no-op update', async () => {
      await settings.update(admin, marketId, { registration_mode: 'MANUAL' });

      await expect(prisma.systemSetting.count()).resolves.toBe(0);
      await expect(prisma.auditLog.count()).resolves.toBe(0);
    });

    it('can clear a nullable setting', async () => {
      await settings.update(admin, marketId, { promptpay_id: '0812345678' });
      await expect(settings.get(marketId, 'promptpay_id')).resolves.toBe('0812345678');

      await settings.update(admin, marketId, { promptpay_id: null });
      await expect(settings.get(marketId, 'promptpay_id')).resolves.toBeNull();
    });
  });

  describe('PUT /admin/settings', () => {
    it('updates and returns the full settings', async () => {
      const res = await http()
        .put('/api/v1/admin/settings')
        .set('Authorization', bearer(admin))
        .send({ registration_mode: 'AUTO', promptpay_id: '081-234-5678' })
        .expect(200);

      expect(res.body.data).toMatchObject({
        registration_mode: 'AUTO',
        promptpay_id: '0812345678',
        hold_minutes: 10,
      });
      const after = await http()
        .get('/api/v1/admin/settings')
        .set('Authorization', bearer(admin))
        .expect(200);
      expect(after.body.data.registration_mode).toBe('AUTO');
    });

    it.each([
      ['wrong type', { hold_minutes: 'ten' }, 'hold_minutes'],
      ['wrong enum value', { registration_mode: 'YES' }, 'registration_mode'],
      ['out of range', { payment_deadline_minutes: 1 }, 'payment_deadline_minutes'],
    ])('rejects a %s with 400 VALIDATION_ERROR', async (_name, body, path) => {
      const res = await http()
        .put('/api/v1/admin/settings')
        .set('Authorization', bearer(admin))
        .send(body)
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].path).toBe(path);
      await expect(prisma.systemSetting.count()).resolves.toBe(0);
    });

    it('rejects unknown keys and empty bodies', async () => {
      await http()
        .put('/api/v1/admin/settings')
        .set('Authorization', bearer(admin))
        .send({ registration_mode: 'AUTO', is_admin: true })
        .expect(400);
      await http()
        .put('/api/v1/admin/settings')
        .set('Authorization', bearer(admin))
        .send({})
        .expect(400);
    });

    it('is forbidden for STAFF', async () => {
      const res = await http()
        .put('/api/v1/admin/settings')
        .set('Authorization', bearer(staff))
        .send({ registration_mode: 'AUTO' })
        .expect(403);

      expect(res.body.error.code).toBe('FORBIDDEN');
      await expect(settings.get(marketId, 'registration_mode')).resolves.toBe('MANUAL');
    });
  });
});
