import { Prisma } from '../generated/prisma/client';
import { REDACTED, isSensitiveKey, redact } from './redact';

describe('redact', () => {
  it('recognises sensitive keys regardless of case and separators', () => {
    for (const key of [
      'password',
      'passwordHash',
      'password_hash',
      'OTP',
      'refresh-token',
      'apiKey',
    ]) {
      expect(isSensitiveKey(key)).toBe(true);
    }
    for (const key of ['username', 'phone', 'status', 'tokenExpiresAt']) {
      expect(isSensitiveKey(key)).toBe(false);
    }
  });

  it('replaces sensitive values at any depth, including inside arrays', () => {
    const input = {
      username: 'admin',
      passwordHash: '$2b$12$abc',
      profile: { refreshToken: 'r', phone: '0812345678' },
      sessions: [{ token: 't1', ip: '1.1.1.1' }],
    };

    expect(redact(input)).toEqual({
      username: 'admin',
      passwordHash: REDACTED,
      profile: { refreshToken: REDACTED, phone: '0812345678' },
      sessions: [{ token: REDACTED, ip: '1.1.1.1' }],
    });
  });

  it('does not mutate the input', () => {
    const input = { password: 'secret' };
    redact(input);

    expect(input.password).toBe('secret');
  });

  it('converts Dates and Prisma Decimals to JSON values', () => {
    const at = new Date('2026-10-31T00:00:00.000Z');

    expect(redact({ at, price: new Prisma.Decimal('150.50') })).toEqual({
      at: '2026-10-31T00:00:00.000Z',
      price: '150.5',
    });
  });

  it('keeps undefined and primitives as-is', () => {
    expect(redact(undefined)).toBeUndefined();
    expect(redact(null)).toBeNull();
    expect(redact('x')).toBe('x');
  });
});
