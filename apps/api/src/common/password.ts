import bcrypt from 'bcryptjs';

/** bcrypt cost ตาม Overview §7.2 (admin_users.password_hash) */
export const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

// hash ของรหัสสุ่มที่ไม่มีใครรู้ — ใช้เทียบเมื่อไม่พบ username เพื่อให้เวลาตอบเท่ากับกรณีรหัสผิด
// (กันการเดาว่า username ไหนมีอยู่จริงจากเวลาที่ใช้)
const DUMMY_HASH = bcrypt.hashSync(`dummy-${Math.random()}`, BCRYPT_COST);

/** เทียบรหัส; ส่ง `null` เมื่อไม่พบผู้ใช้ — ยังเสียเวลาเท่าเดิมแต่คืน false เสมอ */
export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  const ok = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return hash !== null && ok;
}
