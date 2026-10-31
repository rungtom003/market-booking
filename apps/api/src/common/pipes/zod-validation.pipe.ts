import { ErrorCode, ValidationIssue } from '@market-booking/shared';
import { createZodValidationPipe } from 'nestjs-zod';
import { AppException } from '../exceptions/app.exception';

interface ZodLikeIssue {
  path: PropertyKey[];
  message: string;
  code: string;
}

export function toValidationIssues(error: unknown): ValidationIssue[] {
  const issues = (error as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues)) return [];
  return (issues as ZodLikeIssue[]).map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Validation ทั้งระบบใช้ Zod (Decision Log) — DTO สร้างด้วย `createZodDto(schema)` จาก schema ใน packages/shared
 * pipe นี้ตรวจเฉพาะ parameter ที่ type เป็น ZodDto; ผิด → 400 VALIDATION_ERROR พร้อม details รายฟิลด์
 */
export const ZodValidationPipe = createZodValidationPipe({
  createValidationException: (error) =>
    new AppException(
      ErrorCode.VALIDATION_ERROR,
      'Request validation failed',
      toValidationIssues(error),
    ),
});
