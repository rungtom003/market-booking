import { Test } from '@nestjs/testing';
import { ErrorCode } from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS } from '../../redis/redis.module';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  const prisma = { $queryRaw: jest.fn() };
  const redis = { ping: jest.fn() };

  beforeEach(async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redis.ping.mockResolvedValue('PONG');
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS, useValue: redis },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('returns ok status with ISO timestamp', () => {
    const result = controller.check();

    expect(result.status).toBe('ok');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  it('is ready when database and redis answer', async () => {
    await expect(controller.ready()).resolves.toEqual({
      status: 'ok',
      database: 'ok',
      redis: 'ok',
    });
  });

  it('reports which dependency is down', async () => {
    redis.ping.mockRejectedValue(new Error('ECONNREFUSED'));

    const error = await controller.ready().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
    expect((error as AppException).details).toEqual({ database: 'ok', redis: 'down' });
  });
});
