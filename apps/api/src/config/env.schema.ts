import { z } from 'zod';

const isProduction = process.env.NODE_ENV === 'production';

// secret ใน production ต้องยาวพอ; dev ใช้ค่าจาก .env.example ได้
const secret = z.string().min(isProduction ? 32 : 1);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** rate limit "API ทั่วไป" ต่อ IP (Overview §10.4) */
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(100),
    /**
     * ปิด rate limit ต่อ IP ทั้งหมด — ใช้กับ E2E เท่านั้น (ทุก request มาจาก IP เดียว) ห้ามใช้ใน production
     * ข้อจำกัดต่อบัญชี/เบอร์ใน Redis (ล็อค login, OTP 5 ครั้ง/ชั่วโมง) ยังทำงานตามปกติ
     */
    RATE_LIMIT_DISABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true')
      .refine((v) => !(v && isProduction), 'RATE_LIMIT_DISABLED cannot be true in production'),

    /**
     * จำนวน reverse proxy หน้า API ที่เชื่อ `X-Forwarded-For` (Express `trust proxy`) — production หลัง Nginx = 1
     * ไม่ตั้งเมื่ออยู่หลัง proxy: ทุก request ดูเหมือนมาจาก IP ของ proxy (rate limit ต่อ IP รวมกันทั้งระบบ)
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    /** connection pool ต่อ API instance — รวมทุก instance ต้องไม่เกิน max_connections ของ Postgres */
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    /**
     * รัน BullMQ worker + job ประจำ (เช่น กวาดการจองที่หมดเวลา) ใน process นี้
     * ปิดได้เมื่อแยก worker ไปอีก process — ส่วนที่ใส่ job เข้า queue ยังทำงานเสมอ
     */
    WORKERS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),

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

    // LINE Login (LIFF) — ไม่ตั้ง = ปิด login ด้วย LINE
    LINE_LOGIN_CHANNEL_ID: z.string().optional(),
    LINE_LIFF_ID: z.string().optional(),
    /** LINE OA (Messaging API) — ไม่ตั้ง = ไม่ส่ง LINE (ผู้ค้าได้ SMS แทน) */
    LINE_MESSAGING_ACCESS_TOKEN: z.string().optional(),
    /** ตรวจลายเซ็น webhook ของ LINE OA (บอทตอบ group ID เมื่อถูกเชิญเข้ากลุ่ม) */
    LINE_MESSAGING_CHANNEL_SECRET: z.string().optional(),

    /** mock = ไม่ส่งจริง (production ส่งไม่ได้); thaibulksms = ThaiBulkSMS API v2 */
    SMS_PROVIDER: z.enum(['mock', 'thaibulksms']).default('mock'),
    SMS_API_KEY: z.string().optional(),
    SMS_API_SECRET: z.string().optional(),
    /** ชื่อผู้ส่งที่ลงทะเบียนกับผู้ให้บริการแล้ว (ตัวพิมพ์เล็ก/ใหญ่ต้องตรง) */
    SMS_SENDER: z.string().max(11).optional(),
    /** ประเภทเครดิตของ ThaiBulkSMS — ไม่ตั้ง = ค่าเริ่มต้นของบัญชี */
    SMS_CREDIT_TYPE: z.enum(['standard', 'corporate']).optional(),

    WEB_ORIGIN: z.url(),
    ADMIN_ORIGIN: z.url(),
  })
  // ตั้งค่าไม่ครบให้ล้มตอน boot ดีกว่าไปพังตอนผู้ค้าขอ OTP
  .refine(
    (env) =>
      env.SMS_PROVIDER !== 'thaibulksms' ||
      Boolean(env.SMS_API_KEY && env.SMS_API_SECRET && env.SMS_SENDER),
    {
      message: 'SMS_PROVIDER=thaibulksms requires SMS_API_KEY, SMS_API_SECRET and SMS_SENDER',
      path: ['SMS_PROVIDER'],
    },
  );

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
