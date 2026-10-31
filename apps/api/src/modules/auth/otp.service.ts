import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, OTP_LENGTH, OtpRequestResponse } from '@market-booking/shared';
import type Redis from 'ioredis';
import { AppException } from '../../common/exceptions/app.exception';
import { AppConfigService } from '../../config/app-config.service';
import { REDIS } from '../../redis/redis.module';
import { SMS_PROVIDER } from '../notify/sms/sms.provider';
import type { SmsProvider } from '../notify/sms/sms.provider';
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_PER_HOUR,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
} from './auth.constants';

/*
 * Redis ต่อเบอร์ (เบอร์อยู่ในรูป 0XXXXXXXXX แล้ว):
 *   otp:code:<phone>   HMAC ของรหัส          TTL 5 นาที
 *   otp:att:<phone>    จำนวนครั้งที่กรอก       TTL เท่ารหัส — เกิน 5 ครั้งรหัสถูกยกเลิก
 *   otp:cd:<phone>     cooldown ขอใหม่        TTL 60 วินาที
 *   otp:hr:<phone>     จำนวนที่ขอในชั่วโมงนี้   TTL 1 ชั่วโมง (Overview §9.1, §10.4)
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly config: AppConfigService,
  ) {}

  async request(phone: string): Promise<OtpRequestResponse> {
    // SET NX = ผู้ชนะคนเดียวแม้กดพร้อมกัน; ยังติด cooldown → บอกว่าต้องรออีกกี่วินาที
    const gotSlot = await this.redis.set(
      this.key('cd', phone),
      '1',
      'EX',
      OTP_RESEND_COOLDOWN_SECONDS,
      'NX',
    );
    if (!gotSlot) {
      throw this.rateLimited(await this.redis.ttl(this.key('cd', phone)));
    }

    const sentThisHour = await this.redis.incr(this.key('hr', phone));
    if (sentThisHour === 1) await this.redis.expire(this.key('hr', phone), 3600);
    if (sentThisHour > OTP_MAX_PER_HOUR) {
      throw this.rateLimited(await this.redis.ttl(this.key('hr', phone)));
    }

    const code = randomInt(0, 10 ** OTP_LENGTH)
      .toString()
      .padStart(OTP_LENGTH, '0');
    // รหัสใหม่แทนรหัสเดิม และเริ่มนับครั้งที่กรอกใหม่
    await this.redis
      .multi()
      .set(this.key('code', phone), this.hash(phone, code), 'EX', OTP_TTL_SECONDS)
      .del(this.key('att', phone))
      .exec();

    try {
      await this.sms.send({
        to: phone,
        text: `รหัส OTP ของคุณคือ ${code} (ใช้ได้ ${OTP_TTL_SECONDS / 60} นาที) ห้ามบอกรหัสนี้กับผู้อื่น`,
      });
    } catch (error) {
      // ส่งไม่ออก → ไม่นับเป็นการขอ ให้ลองใหม่ได้ทันที
      await this.redis
        .multi()
        .del(this.key('code', phone), this.key('cd', phone))
        .decr(this.key('hr', phone))
        .exec();
      throw error;
    }

    return { expiresIn: OTP_TTL_SECONDS, resendAfter: OTP_RESEND_COOLDOWN_SECONDS };
  }

  /** ถูกต้อง → รหัสถูกใช้ไปแล้ว (ใช้ซ้ำไม่ได้); ผิด → OTP_INVALID; ไม่มี/หมดอายุ/ยกเลิก → OTP_EXPIRED */
  async verify(phone: string, code: string): Promise<void> {
    const codeKey = this.key('code', phone);
    const attKey = this.key('att', phone);

    const stored = await this.redis.get(codeKey);
    if (!stored) throw this.expired();

    // นับก่อนเทียบ (INCR เป็น atomic) — ยิงเดารหัสพร้อมกันก็ได้ไม่เกิน 5 ครั้ง
    const attempts = await this.redis.incr(attKey);
    if (attempts === 1) await this.redis.expire(attKey, OTP_TTL_SECONDS);
    if (attempts > OTP_MAX_ATTEMPTS) {
      await this.redis.del(codeKey, attKey);
      throw this.expired();
    }

    if (!this.matches(this.hash(phone, code), stored)) {
      const attemptsLeft = OTP_MAX_ATTEMPTS - attempts;
      if (attemptsLeft === 0) await this.redis.del(codeKey, attKey);
      throw new AppException(ErrorCode.OTP_INVALID, 'Incorrect OTP', { attemptsLeft });
    }

    // DEL คืน 0 = มีอีก request ใช้รหัสนี้ไปก่อนแล้ว
    const consumed = await this.redis.del(codeKey);
    await this.redis.del(attKey);
    if (!consumed) throw this.expired();
  }

  // ผูกกับเบอร์ด้วย: hash ของรหัสเดียวกันต่างเบอร์ไม่เหมือนกัน; secret ทำให้เดาจาก hash ใน Redis ไม่ได้
  private hash(phone: string, code: string): string {
    return createHmac('sha256', this.config.get('JWT_REFRESH_SECRET'))
      .update(`otp:${phone}:${code}`)
      .digest('hex');
  }

  private matches(a: string, b: string): boolean {
    const x = Buffer.from(a, 'hex');
    const y = Buffer.from(b, 'hex');
    return x.length === y.length && timingSafeEqual(x, y);
  }

  private rateLimited(retryAfterSeconds: number): AppException {
    return new AppException(ErrorCode.RATE_LIMITED, 'OTP requested too often, please wait', {
      retryAfterSeconds: Math.max(retryAfterSeconds, 1),
    });
  }

  private expired(): AppException {
    return new AppException(
      ErrorCode.OTP_EXPIRED,
      'OTP expired or not requested, request a new one',
    );
  }

  private key(kind: 'code' | 'att' | 'cd' | 'hr', phone: string): string {
    return `otp:${kind}:${phone}`;
  }
}
