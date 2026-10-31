import { ErrorCode, ValidationIssue, formatIsoDateTh } from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { zonedDate, zonedDayStart } from '../../common/zoned-date';

/** VALIDATION_ERROR รูปเดียวกับที่ ZodValidationPipe ส่ง — หน้า admin แสดงข้อความใต้ช่องได้เลย */
export function validationError(path: string, message: string): AppException {
  const issue: ValidationIssue = { path, message, code: 'custom' };
  return new AppException(ErrorCode.VALIDATION_ERROR, 'Request validation failed', [issue]);
}

/** วันขาย `YYYY-MM-DD` ใช้ได้ไหมกับรอบนี้ (Overview §9.3): ไม่ใช่วันที่ผ่านมาแล้ว และเริ่มหลังปิดจอง */
export function marketDateIssues(
  dates: string[],
  round: { closeAt: Date },
  timeZone: string,
  now: Date,
): ValidationIssue[] {
  const today = zonedDate(now, timeZone);
  const past = dates.filter((d) => d < today);
  if (past.length > 0) {
    return [
      {
        path: 'dates',
        message: `เลือกวันที่ผ่านมาแล้วไม่ได้: ${past.map((d) => formatIsoDateTh(d)).join(', ')}`,
        code: 'custom',
      },
    ];
  }
  const beforeClose = dates.filter((d) => zonedDayStart(d, timeZone) < round.closeAt);
  if (beforeClose.length > 0) {
    return [
      {
        path: 'dates',
        message: `วันขายต้องอยู่หลังเวลาปิดจอง: ${beforeClose.map((d) => formatIsoDateTh(d)).join(', ')}`,
        code: 'custom',
      },
    ];
  }
  return [];
}

/** `close_at` ต้องไม่เกินเวลาเริ่มวันขายวันแรก (00:00 ตามเวลาตลาด) */
export function assertCloseBeforeFirstDay(
  closeAt: Date,
  firstMarketDate: string | null,
  timeZone: string,
): void {
  if (firstMarketDate && closeAt > zonedDayStart(firstMarketDate, timeZone)) {
    throw validationError(
      'closeAt',
      `ต้องปิดจองก่อนวันขายวันแรก (${formatIsoDateTh(firstMarketDate)})`,
    );
  }
}

/** คอลัมน์ date ของ Prisma (UTC 00:00) ↔ `YYYY-MM-DD` */
export const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);
export const fromIsoDate = (s: string): Date => new Date(`${s}T00:00:00Z`);
