import { Injectable } from '@nestjs/common';
import { SETTING_DEFAULTS, Settings } from '@market-booking/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * อ่าน system_settings ของตลาด (ค่าใน DB ทับค่า default)
 * Phase 1.5 จะเพิ่ม get<K>() แบบ type-safe, cache ใน Redis, validate ด้วย Zod และ PUT
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(marketId: string): Promise<Settings> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { marketId },
      select: { key: true, value: true },
    });
    const stored = Object.fromEntries(
      rows.filter((r) => r.key in SETTING_DEFAULTS).map((r) => [r.key, r.value]),
    );
    return { ...SETTING_DEFAULTS, ...stored } as Settings;
  }
}
