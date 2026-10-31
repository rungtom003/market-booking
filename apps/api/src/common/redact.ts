/**
 * key ที่ห้ามออกไปนอกระบบ (log, audit log) — Overview §13 "ห้ามบันทึก OTP/password/token ลง log"
 * เทียบแบบไม่สนตัวพิมพ์ และตัด `_`/`-` ออกก่อน (password_hash, refreshToken, x-api-key ก็โดน)
 */
const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'otp',
  'otphash',
  'token',
  'accesstoken',
  'refreshtoken',
  'registrationtoken',
  'idtoken',
  'checkintoken',
  'secret',
  'apikey',
  'authorization',
  'cookie',
];

export const REDACTED = '[REDACTED]';

const normalize = (key: string) => key.toLowerCase().replace(/[_-]/g, '');
const sensitive = new Set(SENSITIVE_KEYS);

export function isSensitiveKey(key: string): boolean {
  return sensitive.has(normalize(key));
}

/** path สำหรับ option `redact` ของ pino (pino ไม่รองรับการเทียบแบบ normalize จึงระบุตรงๆ) */
export const PINO_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...['password', 'passwordHash', 'otp', 'token', 'accessToken', 'refreshToken', 'secret'].flatMap(
    (key) => [key, `*.${key}`],
  ),
];

/**
 * คืน copy ที่แทนค่าของ key อ่อนไหวด้วย [REDACTED] (ทุกระดับ) และแปลงเป็น JSON ล้วน
 * (Date → ISO string, Prisma Decimal → string) เพื่อเก็บลง jsonb ได้
 */
export function redact(value: unknown): unknown {
  const json: unknown = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  return redactJson(json);
}

function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        isSensitiveKey(key) ? REDACTED : redactJson(v),
      ]),
    );
  }
  return value;
}
