import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@market-booking/shared';
import type Redis from 'ioredis';
import { AppException } from '../../common/exceptions/app.exception';
import { REDIS } from '../../redis/redis.module';
import { LOGIN_FAILURE_WINDOW_SECONDS, MAX_LOGIN_FAILURES } from './auth.constants';

/** นับ login ผิดต่อบัญชี — ครบ 5 ครั้งใน 15 นาที ล็อค 15 นาที (นับจากครั้งที่ 5) */
@Injectable()
export class LoginAttemptService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** ตรวจก่อนเทียบรหัส — ระหว่างล็อค รหัสถูกก็เข้าไม่ได้ */
  async assertNotLocked(scope: string, username: string): Promise<void> {
    const key = this.key(scope, username);
    const failures = Number(await this.redis.get(key));
    if (failures < MAX_LOGIN_FAILURES) return;

    const retryAfterSeconds = Math.max(await this.redis.ttl(key), 1);
    throw new AppException(
      ErrorCode.ACCOUNT_LOCKED,
      'Too many failed login attempts, account is temporarily locked',
      { retryAfterSeconds },
    );
  }

  async recordFailure(scope: string, username: string): Promise<void> {
    const key = this.key(scope, username);
    const failures = await this.redis.incr(key);
    // ครั้งแรกเริ่มนับหน้าต่าง 15 นาที; ครั้งที่ 5 ต่อเวลาเป็นล็อค 15 นาทีเต็ม
    if (failures === 1 || failures === MAX_LOGIN_FAILURES) {
      await this.redis.expire(key, LOGIN_FAILURE_WINDOW_SECONDS);
    }
  }

  async reset(scope: string, username: string): Promise<void> {
    await this.redis.del(this.key(scope, username));
  }

  private key(scope: string, username: string): string {
    return `login:fail:${scope}:${username.toLowerCase()}`;
  }
}
