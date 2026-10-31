import { z } from 'zod';
import { ActorType, AdminRole } from './enums.js';
import { paginationQuerySchema } from './pagination.js';
import type { Permission } from './permissions.js';

// ───────────── Login / token ─────────────

export const adminLoginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(50),
  password: z.string().min(1).max(200),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

/** refresh/logout ใช้ cookie แยกตามประเภทผู้ใช้ — client บอกว่าเป็นแอปไหน */
export const sessionActorSchema = z.object({
  actorType: z.enum([ActorType.ADMIN, ActorType.VENDOR]),
});
export type SessionActorInput = z.infer<typeof sessionActorSchema>;

export interface AccessTokenResponse {
  accessToken: string;
  /** วินาที */
  expiresIn: number;
}

export interface AdminProfile {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  /** null = ทุกตลาด */
  marketId: string | null;
  permissions: Permission[];
}

export interface AdminLoginResponse extends AccessTokenResponse {
  admin: AdminProfile;
}

// ───────────── Admin users (SUPER_ADMIN) ─────────────

const adminRoleSchema = z.enum([
  AdminRole.SUPER_ADMIN,
  AdminRole.ADMIN,
  AdminRole.STAFF,
  AdminRole.FINANCE,
]);

/** จำนวน byte แบบ UTF-8 (ไม่พึ่ง TextEncoder เพราะ package นี้ไม่มี DOM/Node types) */
function utf8Length(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** bcrypt ใช้แค่ 72 byte แรก — จำกัดไว้กันผู้ใช้เข้าใจผิดว่ารหัสยาวกว่านั้นมีผล (ภาษาไทย 1 ตัว = 3 byte) */
export const adminPasswordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .refine((p) => utf8Length(p) <= 72, 'Password is too long (max 72 bytes)');

export const createAdminUserSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,50}$/, 'Use 3-50 characters: a-z, 0-9, dot, underscore, hyphen'),
  password: adminPasswordSchema,
  displayName: z.string().trim().min(1).max(100),
  role: adminRoleSchema,
  /** ไม่ส่ง = ตลาดหลัก (ยกเว้น SUPER_ADMIN ซึ่งเป็น null เสมอ) */
  marketId: z.uuid().optional(),
});
export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;

export const updateAdminUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100),
    role: adminRoleSchema,
    marketId: z.uuid(),
    isActive: z.boolean(),
    /** ตั้งรหัสใหม่ให้ (ผู้ใช้ต้อง login ใหม่ทุกเครื่อง) */
    password: adminPasswordSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateAdminUserInput = z.infer<typeof updateAdminUserSchema>;

export const adminUserListQuerySchema = paginationQuerySchema.extend({
  /** ค้นหา username / ชื่อที่แสดง */
  q: z.string().trim().max(100).optional(),
  role: adminRoleSchema.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  marketId: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}
