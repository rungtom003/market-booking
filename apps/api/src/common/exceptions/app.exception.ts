import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@market-booking/shared';
import { ERROR_HTTP_STATUS } from './error-status';

/**
 * Error ทางธุรกิจทุกตัวโยนผ่าน class นี้ — status มาจาก code อัตโนมัติ
 * @example throw new AppException(ErrorCode.STALL_TAKEN, 'Stall is already taken');
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string = code,
    readonly details?: unknown,
  ) {
    super(message, ERROR_HTTP_STATUS[code]);
  }
}
