import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SETTING_DEFAULTS,
  SETTING_KEYS,
  SettingKey,
  Settings,
  UpdateSettingsInput,
  settingFields,
} from '@market-booking/shared';
import type Redis from 'ioredis';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS } from '../../redis/redis.module';
import { AuditService } from '../audit/audit.service';
import type { AdminPrincipal } from '../auth/principal';

/** cache หมดอายุเองด้วย — จำกัดเวลาที่ค่าอาจค้าง ถ้า Redis พลาดตอนเพิ่ม version */
const CACHE_TTL_SECONDS = 300;

/**
 * อ่าน/แก้ system_settings ต่อตลาด (Overview §12) — ค่าใน DB ทับค่า default, cache ใน Redis
 *
 * Cache ใช้ version: `settings:v:<market>` = เลข version, ข้อมูลอยู่ที่ `settings:<market>:<version>`
 * แก้ค่า → commit แล้วค่อย INCR version ทำให้ทุกคนอ่านชุดใหม่ทันที
 * (ถ้าใช้ DEL เฉยๆ request ที่อ่าน DB ก่อน commit อาจเขียนค่าเก่ากลับเข้า cache หลังลบ แล้วค้างจน TTL หมด)
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** ค่าเดียวแบบ type-safe เช่น `get(marketId, 'hold_minutes')` → number */
  async get<K extends SettingKey>(marketId: string, key: K): Promise<Settings[K]> {
    return (await this.getAll(marketId))[key];
  }

  async getAll(marketId: string): Promise<Settings> {
    const version = await this.cacheVersion(marketId);
    if (version !== null) {
      const cached = await this.safeRedis(() => this.redis.get(this.cacheKey(marketId, version)));
      if (cached) return JSON.parse(cached) as Settings;
    }

    const settings = await this.loadFromDb(this.prisma, marketId);
    if (version !== null) {
      await this.safeRedis(() =>
        this.redis.set(
          this.cacheKey(marketId, version),
          JSON.stringify(settings),
          'EX',
          CACHE_TTL_SECONDS,
        ),
      );
    }
    return settings;
  }

  /** แก้เฉพาะ key ที่ส่งมา (validate แล้วด้วย updateSettingsSchema) — คืนค่าทั้งชุดหลังแก้ */
  async update(
    actor: AdminPrincipal,
    marketId: string,
    patch: UpdateSettingsInput,
  ): Promise<Settings> {
    const result = await this.prisma.$transaction(async (tx) => {
      const before = await this.loadFromDb(tx, marketId);
      const changed = (Object.keys(patch) as SettingKey[]).filter(
        (key) => JSON.stringify(patch[key]) !== JSON.stringify(before[key]),
      );

      for (const key of changed) {
        const value = toJson(patch[key]);
        await tx.systemSetting.upsert({
          where: { marketId_key: { marketId, key } },
          create: { marketId, key, value, updatedById: actor.id },
          update: { value, updatedById: actor.id },
        });
      }

      const after = { ...before, ...patch } as Settings;
      if (changed.length > 0) {
        await this.audit.log(
          {
            actorType: 'ADMIN',
            actorId: actor.id,
            action: 'settings.update',
            entity: { type: 'market', id: marketId },
            // เก็บเฉพาะ key ที่เปลี่ยนจริง อ่านง่ายใน audit log
            before: pick(before, changed),
            after: pick(after, changed),
          },
          tx,
        );
      }
      return { after, changed: changed.length > 0 };
    });

    // หลัง commit เท่านั้น — ดูคำอธิบายที่หัว class
    if (result.changed) await this.safeRedis(() => this.redis.incr(this.versionKey(marketId)));
    return result.after;
  }

  private async loadFromDb(
    db: Pick<Prisma.TransactionClient, 'systemSetting'>,
    marketId: string,
  ): Promise<Settings> {
    const rows = await db.systemSetting.findMany({
      where: { marketId },
      select: { key: true, value: true },
    });
    const settings: Record<string, unknown> = { ...SETTING_DEFAULTS };
    for (const row of rows) {
      if (!SETTING_KEYS.includes(row.key as SettingKey)) continue;
      const key = row.key as SettingKey;
      // ค่าใน DB อาจผิดรูปแบบ (แก้มือ / schema เปลี่ยน) — ไม่ให้ระบบล่ม ใช้ค่า default แทนแล้วเตือน
      const parsed = settingFields[key].safeParse(row.value);
      if (parsed.success) settings[key] = parsed.data;
      else
        this.logger.warn(`Invalid stored setting "${key}" for market ${marketId}; using default`);
    }
    return settings as Settings;
  }

  private async cacheVersion(marketId: string): Promise<string | null> {
    const version = await this.safeRedis(() => this.redis.get(this.versionKey(marketId)));
    // ยังไม่เคยแก้ = version 0; Redis ล่ม (undefined) = ไม่ใช้ cache
    return version === undefined ? null : (version ?? '0');
  }

  /** Redis ล่ม → อ่านจาก DB ตรง (ช้าลงแต่ไม่พัง) */
  private async safeRedis<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (error) {
      this.logger.warn(`Settings cache unavailable: ${String(error)}`);
      return undefined;
    }
  }

  private versionKey = (marketId: string) => `settings:v:${marketId}`;
  private cacheKey = (marketId: string, version: string) => `settings:${marketId}:${version}`;
}

function pick(settings: Settings, keys: SettingKey[]): Partial<Settings> {
  return Object.fromEntries(keys.map((k) => [k, settings[k]])) as Partial<Settings>;
}

// null ของ JSON ต้องเป็น Prisma.JsonNull (column `value` ห้ามเป็น SQL NULL)
function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}
