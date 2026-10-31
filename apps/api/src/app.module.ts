import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AppLoggerModule } from './common/logger/logger.module';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe';
import { AppConfigService } from './config/app-config.service';
import { AppConfigModule } from './config/config.module';
import { AuditModule } from './modules/audit/audit.module';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { REDIS, RedisModule } from './redis/redis.module';

@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    PrismaModule,
    RedisModule,
    // นับใน Redis เพื่อให้ limit ถูกต้องเมื่อรัน API หลาย instance (Overview §5 ข้อ 5)
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService, REDIS],
      useFactory: (config: AppConfigService, redis: Redis) => ({
        // ค่าเริ่มต้น "API ทั่วไป 100 ครั้ง/นาที ต่อ IP" (Overview §10.4) — endpoint เฉพาะตั้งเองด้วย @Throttle()
        throttlers: [{ name: 'default', ttl: 60_000, limit: config.get('RATE_LIMIT_PER_MINUTE') }],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    AuditModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
