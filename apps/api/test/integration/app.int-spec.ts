import { Body, Controller, Get, INestApplication, Post, Query } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ErrorCode, paginationQuerySchema } from '@market-booking/shared';
import Redis from 'ioredis';
import { createZodDto } from 'nestjs-zod';
import request from 'supertest';
import { z } from 'zod';
import { AppModule } from '../../src/app.module';
import { AppException } from '../../src/common/exceptions/app.exception';
import { PaginatedResult } from '../../src/common/pagination/paginated-result';
import { setupApp } from '../../src/setup-app';
import { testRedisUrl } from './test-db-url';

class EchoDto extends createZodDto(z.object({ name: z.string().min(1), qty: z.number().int() })) {}
class PageQueryDto extends createZodDto(paginationQuerySchema) {}

/** controller สำหรับ test เท่านั้น — ใช้ตรวจ pipeline ทั้งชุด (guard → pipe → interceptor → filter) */
@Controller('probe')
class ProbeController {
  @Get()
  ok() {
    return { ok: true };
  }

  @Post('echo')
  echo(@Body() body: EchoDto) {
    return body;
  }

  @Get('page')
  page(@Query() query: PageQueryDto) {
    return PaginatedResult.of(['a', 'b'], 42, query);
  }

  @Get('business-error')
  businessError() {
    throw new AppException(ErrorCode.STALL_TAKEN, 'Stall is already taken', { stallId: 's1' });
  }

  @Get('crash')
  crash() {
    throw new Error('database password is hunter2');
  }
}

describe('HTTP pipeline (integration)', () => {
  let app: INestApplication;
  let redis: Redis;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    redis = new Redis(testRedisUrl());
  });

  // rate limit นับต่อ IP ข้าม test — ล้างก่อนทุก test
  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    redis.disconnect();
    await app.close();
  });

  describe('response envelope', () => {
    it('wraps results in { data } (health)', async () => {
      const res = await http().get('/api/v1/health').expect(200);

      expect(res.body).toEqual({
        data: { status: 'ok', uptime: expect.any(Number), timestamp: expect.any(String) },
      });
    });

    it('returns { data, meta } for paginated results', async () => {
      const res = await http().get('/api/v1/probe/page?page=2&pageSize=10').expect(200);

      expect(res.body).toEqual({
        data: ['a', 'b'],
        meta: { page: 2, pageSize: 10, total: 42, totalPages: 5 },
      });
    });

    it('is only served under /api/v1', async () => {
      await http().get('/health').expect(404);
    });
  });

  describe('error format { error: { code, message, details? } }', () => {
    it('business errors carry their code, status and details', async () => {
      const res = await http().get('/api/v1/probe/business-error').expect(409);

      expect(res.body).toEqual({
        error: {
          code: 'STALL_TAKEN',
          message: 'Stall is already taken',
          details: { stallId: 's1' },
        },
      });
    });

    it('unknown routes → 404 NOT_FOUND', async () => {
      const res = await http().get('/api/v1/does-not-exist').expect(404);

      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('invalid bodies → 400 VALIDATION_ERROR with per-field details', async () => {
      const res = await http().post('/api/v1/probe/echo').send({ name: '', qty: 1.5 }).expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
        'name',
        'qty',
      ]);
    });

    it('valid bodies pass through the Zod pipe', async () => {
      const res = await http().post('/api/v1/probe/echo').send({ name: 'A1', qty: 2 }).expect(201);

      expect(res.body).toEqual({ data: { name: 'A1', qty: 2 } });
    });

    it('malformed JSON → 400 BAD_REQUEST', async () => {
      const res = await http()
        .post('/api/v1/probe/echo')
        .set('Content-Type', 'application/json')
        .send('{"name": ')
        .expect(400);

      expect(res.body.error.code).toBe('BAD_REQUEST');
    });

    it('unexpected errors → 500 INTERNAL_ERROR without leaking the message', async () => {
      const res = await http().get('/api/v1/probe/crash').expect(500);

      expect(res.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
      expect(JSON.stringify(res.body)).not.toContain('hunter2');
    });
  });

  describe('rate limit (RATE_LIMIT_PER_MINUTE=5 in tests)', () => {
    it('returns 429 RATE_LIMITED after the limit is exceeded', async () => {
      for (let i = 0; i < 5; i++) await http().get('/api/v1/probe').expect(200);

      const res = await http().get('/api/v1/probe').expect(429);
      expect(res.body.error.code).toBe(ErrorCode.RATE_LIMITED);
    });

    it('stores counters in Redis (shared across API instances)', async () => {
      await http().get('/api/v1/probe').expect(200);

      expect((await redis.keys('*')).length).toBeGreaterThan(0);
    });

    it('does not rate limit the health check', async () => {
      for (let i = 0; i < 8; i++) await http().get('/api/v1/health').expect(200);
    });
  });

  describe('request id, security headers, CORS', () => {
    it('generates x-request-id when missing', async () => {
      const res = await http().get('/api/v1/health');

      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('echoes a safe incoming x-request-id and replaces an unsafe one', async () => {
      const ok = await http().get('/api/v1/health').set('x-request-id', 'abc-123');
      // (Node HTTP client ไม่ยอมส่ง \n ใน header อยู่แล้ว — ทดสอบด้วยช่องว่าง/อักขระ HTML แทน)
      const bad = await http().get('/api/v1/health').set('x-request-id', 'bad id <script>');

      expect(ok.headers['x-request-id']).toBe('abc-123');
      expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('sets helmet security headers', async () => {
      const res = await http().get('/api/v1/health');

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('allows CORS only for the configured origins', async () => {
      const allowed = await http().get('/api/v1/health').set('Origin', 'http://localhost:5174');
      const denied = await http().get('/api/v1/health').set('Origin', 'https://evil.example');

      expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5174');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('Swagger', () => {
    it('serves the UI at /api/docs and the spec at /api/docs-json', async () => {
      await http().get('/api/docs').expect(200);
      const spec = await http().get('/api/docs-json').expect(200);

      expect(Object.keys(spec.body.paths)).toEqual(
        expect.arrayContaining(['/api/v1/health', '/api/v1/probe/echo']),
      );
    });
  });
});
