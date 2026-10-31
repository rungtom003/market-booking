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
import { AdminUserModule } from './modules/admin-user/admin-user.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BookingModule } from './modules/booking/booking.module';
import { HealthModule } from './modules/health/health.module';
import { MarketModule } from './modules/market/market.module';
import { MarketSetupModule } from './modules/market-setup/market-setup.module';
import { NotifyModule } from './modules/notify/notify.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RoundModule } from './modules/round/round.module';
import { SettingsModule } from './modules/settings/settings.module';
import { StorageModule } from './modules/storage/storage.module';
import { VendorModule } from './modules/vendor/vendor.module';
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
        skipIf: () => config.get('RATE_LIMIT_DISABLED'),
      }),
    }),
    AuditModule,
    MarketModule,
    NotifyModule,
    StorageModule,
    AuthModule,
    HealthModule,
    AdminUserModule,
    SettingsModule,
    VendorModule,
    MarketSetupModule,
    RoundModule,
    BookingModule,
    RealtimeModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    // rate limit ก่อนตรวจ token — request ที่ไม่มี token ก็โดนจำกัด (guard ของ auth อยู่ใน AuthModule)
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
