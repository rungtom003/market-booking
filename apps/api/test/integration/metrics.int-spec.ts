import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { LineMessagingProvider } from '../../src/modules/notify/line/line-messaging.provider';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupApp } from '../../src/setup-app';
import { truncateAll } from './test-db';

const METRICS = { Authorization: `Bearer ${process.env.METRICS_TOKEN}` };
const ALERTS = { Authorization: `Bearer ${process.env.ALERT_WEBHOOK_TOKEN}` };
const GROUP_ID = `C${'a'.repeat(32)}`;

describe('Monitoring: /metrics + Alertmanager webhook (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const line = { enabled: true, push: jest.fn(), reply: jest.fn() };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LineMessagingProvider)
      .useValue(line)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await truncateAll(prisma as unknown as PrismaClient);
    const market = await prisma.market.create({ data: { name: 'ตลาด metrics', address: '-' } });
    const admin = await prisma.adminUser.create({
      data: {
        username: 'metrics-admin',
        passwordHash: 'x',
        displayName: 'm',
        role: 'ADMIN',
        marketId: market.id,
      },
    });
    await app
      .get(SettingsService)
      .update({ actorType: 'ADMIN', id: admin.id, role: 'ADMIN', marketId: market.id }, market.id, {
        line_admin_group_id: GROUP_ID,
      });
  });

  afterAll(async () => {
    await app.close();
  });

  it('metrics ต้องมี token; มีเวลาตอบตามรูปแบบ route (ไม่ใช่ path จริง), queue, socket และ process', async () => {
    await http().get('/api/v1/metrics').expect(401);
    await http().get('/api/v1/metrics').set({ Authorization: 'Bearer wrong' }).expect(401);

    // request ที่ต้องการวัด: route มี parameter → label เป็นรูปแบบ
    await http().get('/api/v1/rounds/current').expect(401);
    await http().get('/api/v1/bookings/0193a5e0-0000-7000-8000-000000000001/payment').expect(401);

    const res = await http().get('/api/v1/metrics').set(METRICS).expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    const text = res.text;
    expect(text).toMatch(
      /http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/rounds\/current",status="401"\} \d+/,
    );
    expect(text).toContain('route="/api/v1/bookings/:id/payment"');
    expect(text).not.toContain('0193a5e0-0000-7000-8000-000000000001');
    expect(text).not.toContain('route="/api/v1/metrics"');
    expect(text).toMatch(/market_queue_jobs\{queue="notification",state="waiting"\} \d+/);
    expect(text).toMatch(/market_socket_connections \d+/);
    expect(text).toMatch(/market_notifications_failed_last_hour \d+/);
    expect(text).toContain('process_resident_memory_bytes');
    expect(text).toContain('nodejs_eventloop_lag_p99_seconds');
  });

  it('Alertmanager webhook ต้องมี token → ส่งต่อ LINE กลุ่มเจ้าหน้าที่ (firing/resolved ไม่ซ้ำกัน)', async () => {
    const alert = (status: string) => ({
      alerts: [
        {
          status,
          fingerprint: 'abc123',
          startsAt: '2026-11-02T03:00:00Z',
          labels: { alertname: 'HighErrorRate', severity: 'critical' },
          annotations: { summary: 'API ตอบ error เกิน 5%', description: '5xx 7.2% ใน 5 นาที' },
        },
      ],
    });
    await http().post('/api/v1/internal/alerts').send(alert('firing')).expect(401);
    await http().post('/api/v1/internal/alerts').set(ALERTS).send(alert('firing')).expect(204);
    // Alertmanager ส่งซ้ำ (repeat_interval) — dedupe ไม่ส่งซ้ำ
    await http().post('/api/v1/internal/alerts').set(ALERTS).send(alert('firing')).expect(204);
    await http().post('/api/v1/internal/alerts').set(ALERTS).send(alert('resolved')).expect(204);

    const logs = await prisma.notificationLog.findMany({
      where: { template: 'admin.alert' },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((l) => [l.recipient, (l.payload as { status: string }).status])).toEqual([
      [GROUP_ID, 'firing'],
      [GROUP_ID, 'resolved'],
    ]);
    const metrics = await http().get('/api/v1/metrics').set(METRICS).expect(200);
    expect(metrics.text).toMatch(/market_alert_webhooks_total\{status="firing"\} 2/);
  });
});
