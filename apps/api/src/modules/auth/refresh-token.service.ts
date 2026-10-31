import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@market-booking/shared';
import type Redis from 'ioredis';
import { AppException } from '../../common/exceptions/app.exception';
import { AppConfigService } from '../../config/app-config.service';
import { REDIS } from '../../redis/redis.module';
import { REFRESH_TOKEN_TTL_SECONDS } from './auth.constants';
import type { Principal } from './principal';

export interface SessionActor {
  type: Principal['actorType'];
  id: string;
}

interface StoredSession {
  fam: string;
  typ: SessionActor['type'];
  sub: string;
  /** HMAC ของ secret — ไม่เก็บ token ตัวจริง */
  h: string;
}

/*
 * Refresh token = `<sessionId>.<secret>` (สุ่ม ไม่ใช่ JWT) เก็บใน Redis:
 *   rt:s:<sessionId>    → StoredSession                 session ที่ใช้ได้ (ใช้ได้ครั้งเดียว)
 *   rt:u:<sessionId>    → familyId                      session ที่ถูก rotate ไปแล้ว (ไว้จับการใช้ซ้ำ)
 *   rt:f:<familyId>     → sessionId ปัจจุบันของ family   1 family = 1 การ login บน 1 อุปกรณ์
 *   rt:a:<type>:<id>    → set ของ familyId               ไว้ revoke ทุกเครื่องของผู้ใช้
 *
 * Rotation: refresh 1 ครั้ง = ลบ session เดิม (GETDEL — atomic, ยิงพร้อมกันได้ผู้ชนะคนเดียว) แล้วออกใหม่ใน family เดิม
 * ใช้ token ที่ rotate ไปแล้วซ้ำ = น่าจะถูกขโมย → revoke ทั้ง family (เจ้าของตัวจริงต้อง login ใหม่ด้วย)
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: AppConfigService,
  ) {}

  /** ออก token ใหม่สำหรับการ login ครั้งใหม่ (family ใหม่) */
  async issue(actor: SessionActor): Promise<string> {
    return this.createSession(actor, randomUUID());
  }

  /** ใช้ token แลก token ใหม่ — token เดิมใช้ไม่ได้อีก */
  async rotate(token: string): Promise<{ actor: SessionActor; token: string }> {
    const parsed = this.parse(token);
    if (!parsed) throw this.unauthorized();

    const raw = await this.redis.getdel(this.sessionKey(parsed.sessionId));
    if (!raw) {
      await this.handlePossibleReuse(parsed.sessionId);
      throw this.unauthorized();
    }

    const session = JSON.parse(raw) as StoredSession;
    if (!this.matches(parsed.secret, session.h)) {
      // sessionId ถูกแต่ secret ผิด = ปลอมแปลง — ทิ้ง family นี้ไปเลย
      await this.revokeFamily(session.fam, { type: session.typ, id: session.sub });
      throw this.unauthorized();
    }

    await this.redis.set(
      this.usedKey(parsed.sessionId),
      session.fam,
      'EX',
      REFRESH_TOKEN_TTL_SECONDS,
    );
    const actor = { type: session.typ, id: session.sub };
    return { actor, token: await this.createSession(actor, session.fam) };
  }

  /** logout เครื่องนี้ — token ผิด/หมดอายุก็ไม่ error */
  async revoke(token: string): Promise<void> {
    const parsed = this.parse(token);
    if (!parsed) return;
    const raw = await this.redis.getdel(this.sessionKey(parsed.sessionId));
    if (!raw) return;
    const session = JSON.parse(raw) as StoredSession;
    if (!this.matches(parsed.secret, session.h)) return;
    await this.revokeFamily(session.fam, { type: session.typ, id: session.sub });
  }

  /** logout ทุกเครื่อง — ใช้ตอนเปลี่ยนรหัส/role หรือปิดบัญชี */
  async revokeAll(actor: SessionActor): Promise<void> {
    const actorKey = this.actorKey(actor);
    const families = await this.redis.smembers(actorKey);
    for (const fam of families) await this.revokeFamily(fam, actor);
    await this.redis.del(actorKey);
  }

  private async createSession(actor: SessionActor, fam: string): Promise<string> {
    const sessionId = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const session: StoredSession = { fam, typ: actor.type, sub: actor.id, h: this.hash(secret) };
    const ttl = REFRESH_TOKEN_TTL_SECONDS;

    await this.redis
      .multi()
      .set(this.sessionKey(sessionId), JSON.stringify(session), 'EX', ttl)
      .set(this.familyKey(fam), sessionId, 'EX', ttl)
      .sadd(this.actorKey(actor), fam)
      .expire(this.actorKey(actor), ttl)
      .exec();

    return `${sessionId}.${secret}`;
  }

  private async handlePossibleReuse(sessionId: string): Promise<void> {
    const fam = await this.redis.get(this.usedKey(sessionId));
    if (!fam) return; // token หมดอายุ/ไม่เคยมี — ไม่ใช่การใช้ซ้ำ

    const current = await this.redis.get(this.familyKey(fam));
    const raw = current ? await this.redis.get(this.sessionKey(current)) : null;
    const owner = raw ? (JSON.parse(raw) as StoredSession) : null;
    this.logger.warn(`Refresh token reuse detected (family ${fam}) — revoking family`);
    if (owner) await this.revokeFamily(fam, { type: owner.typ, id: owner.sub });
    else await this.redis.del(this.familyKey(fam));
  }

  private async revokeFamily(fam: string, actor: SessionActor): Promise<void> {
    const current = await this.redis.get(this.familyKey(fam));
    const tx = this.redis.multi().del(this.familyKey(fam)).srem(this.actorKey(actor), fam);
    if (current) tx.del(this.sessionKey(current));
    await tx.exec();
  }

  private parse(token: string): { sessionId: string; secret: string } | null {
    const [sessionId, secret, ...rest] = token.split('.');
    if (!sessionId || !secret || rest.length > 0 || sessionId.length > 64 || secret.length > 128) {
      return null;
    }
    return { sessionId, secret };
  }

  // HMAC ด้วย JWT_REFRESH_SECRET: ถ้า Redis รั่ว ก็เอา hash ไปใช้แทน token ไม่ได้
  private hash(secret: string): string {
    return createHmac('sha256', this.config.get('JWT_REFRESH_SECRET')).update(secret).digest('hex');
  }

  private matches(secret: string, expectedHash: string): boolean {
    const a = Buffer.from(this.hash(secret), 'hex');
    const b = Buffer.from(expectedHash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private unauthorized(): AppException {
    return new AppException(ErrorCode.UNAUTHORIZED, 'Invalid or expired refresh token');
  }

  private sessionKey = (id: string) => `rt:s:${id}`;
  private usedKey = (id: string) => `rt:u:${id}`;
  private familyKey = (fam: string) => `rt:f:${fam}`;
  private actorKey = (a: SessionActor) => `rt:a:${a.type}:${a.id}`;
}
