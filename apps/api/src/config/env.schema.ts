import { z } from 'zod';

const isProduction = process.env.NODE_ENV === 'production';

// secret ใน production ต้องยาวพอ; dev ใช้ค่าจาก .env.example ได้
const secret = z.string().min(isProduction ? 32 : 1);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** rate limit "API ทั่วไป" ต่อ IP (Overview §10.4) */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(100),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),

  JWT_ACCESS_SECRET: secret,
  JWT_REFRESH_SECRET: secret,

  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().min(1),
  MINIO_USE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** URL ของ MinIO ที่ browser เข้าถึง (ใช้ลงลายเซ็น presigned URL) — ไม่ตั้ง = ใช้ endpoint ภายใน */
  MINIO_PUBLIC_URL: z.url().optional(),

  // ใช้ใน Phase 1.4 / 7 — ยังไม่บังคับ
  LINE_LOGIN_CHANNEL_ID: z.string().optional(),
  LINE_LIFF_ID: z.string().optional(),
  LINE_MESSAGING_ACCESS_TOKEN: z.string().optional(),
  SMS_PROVIDER: z.enum(['mock']).default('mock'),
  SMS_API_KEY: z.string().optional(),

  WEB_ORIGIN: z.url(),
  ADMIN_ORIGIN: z.url(),
});

export type Env = z.infer<typeof envSchema>;

/** ใช้กับ `ConfigModule.forRoot({ validate })` — โยน error ตอน boot ถ้า env ไม่ครบ/ผิดรูปแบบ */
export function validateEnv(raw: Record<string, unknown>): Env {
  // ค่าว่างใน .env (เช่น `LINE_LIFF_ID=`) ให้ถือว่าไม่ได้ตั้ง
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ''));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
