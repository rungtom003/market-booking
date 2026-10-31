import { validateEnv } from './env.schema';

const validEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://market:market_dev@localhost:5432/market_booking',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'access',
  JWT_REFRESH_SECRET: 'refresh',
  MINIO_ENDPOINT: 'localhost',
  MINIO_PORT: '9000',
  MINIO_ACCESS_KEY: 'key',
  MINIO_SECRET_KEY: 'secret',
  MINIO_BUCKET: 'market-booking',
  LINE_LIFF_ID: '',
  WEB_ORIGIN: 'http://localhost:5173',
  ADMIN_ORIGIN: 'http://localhost:5174',
};

describe('validateEnv', () => {
  it('parses a valid env and applies defaults', () => {
    const env = validateEnv(validEnv);

    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.RATE_LIMIT_PER_MINUTE).toBe(100);
    expect(env.RATE_LIMIT_DISABLED).toBe(false);
    expect(env.MINIO_PORT).toBe(9000);
    expect(env.SMS_PROVIDER).toBe('mock');
  });

  it('parses RATE_LIMIT_DISABLED (E2E only)', () => {
    expect(validateEnv({ ...validEnv, RATE_LIMIT_DISABLED: 'true' }).RATE_LIMIT_DISABLED).toBe(
      true,
    );
    expect(() => validateEnv({ ...validEnv, RATE_LIMIT_DISABLED: 'yes' })).toThrow(
      /RATE_LIMIT_DISABLED/,
    );
  });

  it('treats empty strings as unset', () => {
    expect(validateEnv(validEnv).LINE_LIFF_ID).toBeUndefined();
  });

  it('throws with the offending key when a required var is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = validEnv;

    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ ...validEnv, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
