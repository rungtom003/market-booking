import { SETTING_DEFAULTS } from '@market-booking/shared';
import type Redis from 'ioredis';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { SettingsService } from './settings.service';

function prismaWith(rows: { key: string; value: unknown }[]) {
  return {
    systemSetting: { findMany: jest.fn().mockResolvedValue(rows) },
  } as unknown as PrismaService;
}

const redisDown = {
  get: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
  set: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
} as unknown as Redis;

const audit = {} as AuditService;

describe('SettingsService (unit)', () => {
  it('falls back to the database when Redis is down', async () => {
    const service = new SettingsService(
      prismaWith([{ key: 'hold_minutes', value: 20 }]),
      audit,
      redisDown,
    );

    await expect(service.get('m1', 'hold_minutes')).resolves.toBe(20);
  });

  it('uses defaults for missing keys and ignores unknown or invalid stored values', async () => {
    const service = new SettingsService(
      prismaWith([
        { key: 'registration_mode', value: 'AUTO' },
        { key: 'hold_minutes', value: 'ten' }, // แก้มือใน DB ผิดประเภท
        { key: 'retired_setting', value: true },
      ]),
      audit,
      redisDown,
    );

    const settings = await service.getAll('m1');
    expect(settings.registration_mode).toBe('AUTO');
    expect(settings.hold_minutes).toBe(SETTING_DEFAULTS.hold_minutes);
    expect(settings).not.toHaveProperty('retired_setting');
  });
});
