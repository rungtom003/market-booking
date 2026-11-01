import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ErrorCode } from '@market-booking/shared';
import type { HealthStatus, ReadinessStatus } from '@market-booking/shared';
import type Redis from 'ioredis';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS } from '../../redis/redis.module';
import { Public } from '../auth/decorators';

/** เกินเวลานี้ถือว่า dependency ไม่พร้อม — uptime monitor ไม่ต้องรอจน timeout ของตัวเอง */
const CHECK_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS).unref(),
    ),
  ]);
}

@ApiTags('health')
@Public()
// uptime monitor / docker healthcheck เรียกถี่ ไม่ควรโดน rate limit
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** liveness — process ยังตอบได้ (ใช้กับ docker healthcheck: ไม่พังตาม DB) */
  @Get()
  @ApiOkResponse({ description: '`{ data: { status: "ok", uptime, timestamp } }`' })
  check(): HealthStatus {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** readiness — ต่อ PostgreSQL และ Redis ได้ (ใช้กับ uptime monitor) */
  @Get('ready')
  @ApiOkResponse({ description: '`{ data: { status: "ok", database: "ok", redis: "ok" } }`' })
  @ApiServiceUnavailableResponse({ description: 'dependency ตัวใดตัวหนึ่งไม่ตอบ' })
  async ready(): Promise<ReadinessStatus> {
    const [database, redis] = await Promise.all([
      withTimeout(this.prisma.$queryRaw`SELECT 1`).then(
        () => 'ok' as const,
        () => 'down' as const,
      ),
      withTimeout(this.redis.ping()).then(
        () => 'ok' as const,
        () => 'down' as const,
      ),
    ]);
    if (database !== 'ok' || redis !== 'ok') {
      throw new AppException(ErrorCode.SERVICE_UNAVAILABLE, 'Dependency unavailable', {
        database,
        redis,
      });
    }
    return { status: 'ok', database, redis };
  }
}
