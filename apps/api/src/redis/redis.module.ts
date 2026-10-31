import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/app-config.service';

/** inject ด้วย `@Inject(REDIS) redis: Redis` — connection เดียวใช้ร่วมทั้ง app (rate limit, OTP, cache) */
export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new Redis(config.get('REDIS_URL'), {
          // ต่อตอนใช้งานครั้งแรก — app/test ที่ไม่แตะ Redis boot ได้โดยไม่ต้องมี Redis
          lazyConnect: true,
          // Redis ล่มแล้ว request ไม่ค้างนาน: ลองใหม่ 2 ครั้งแล้วโยน error (→ 500)
          maxRetriesPerRequest: 2,
        }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    // quit() ส่ง QUIT แล้วรอปิด; ถ้ายังไม่เคยต่อ ให้ disconnect() ตรงๆ (quit จะพยายามต่อก่อน)
    if (this.redis.status === 'ready') await this.redis.quit();
    else this.redis.disconnect();
  }
}
