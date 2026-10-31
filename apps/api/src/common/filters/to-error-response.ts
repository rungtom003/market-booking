import { HttpException, HttpStatus } from '@nestjs/common';
import { ApiErrorResponse, ErrorCode } from '@market-booking/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../exceptions/app.exception';
import { STATUS_ERROR_CODE } from '../exceptions/error-status';

export interface ErrorResult {
  status: number;
  body: ApiErrorResponse;
  /** true = error ที่ไม่ได้คาดไว้ ต้อง log stack */
  unexpected: boolean;
}

function result(
  status: number,
  code: ErrorCode,
  message: string,
  details?: unknown,
  unexpected = false,
): ErrorResult {
  const error: ApiErrorResponse['error'] = { code, message };
  if (details !== undefined) error.details = details;
  return { status, body: { error }, unexpected };
}

/** ข้อความจาก HttpException ของ Nest (response เป็น string หรือ `{ message: string | string[] }`) */
function httpMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('; ');
  return typeof message === 'string' ? message : exception.message;
}

/** error ของ body-parser (express) มี `type` และ `status` — เช่น JSON ผิดรูปแบบ, body ใหญ่เกิน */
function isBodyParserError(e: unknown): e is { type: string; status: number } {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { type?: unknown }).type === 'string' &&
    (e as { type: string }).type.startsWith('entity.') &&
    typeof (e as { status?: unknown }).status === 'number'
  );
}

/**
 * แปลง exception ทุกชนิดเป็น format เดียว `{ error: { code, message, details? } }` (Overview §11)
 * error ที่ไม่ได้คาดไว้ (5xx) ไม่ส่งข้อความจริงออกไป — กันข้อมูลภายในรั่ว
 */
export function toErrorResponse(exception: unknown): ErrorResult {
  if (exception instanceof AppException) {
    return result(exception.getStatus(), exception.code, exception.message, exception.details);
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= 500) {
      return result(status, ErrorCode.INTERNAL_ERROR, 'Internal server error', undefined, true);
    }
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      return result(status, ErrorCode.RATE_LIMITED, 'Too many requests, please try again later');
    }
    return result(
      status,
      STATUS_ERROR_CODE[status] ?? ErrorCode.BAD_REQUEST,
      httpMessage(exception),
    );
  }

  if (isBodyParserError(exception) && exception.status < 500) {
    return result(exception.status, ErrorCode.BAD_REQUEST, 'Malformed request body');
  }

  // ปกติ service ควรจับเองแล้วโยน AppException ที่เจาะจงกว่า (เช่น P2002 → STALL_TAKEN) — นี่คือ fallback
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === 'P2002') {
      return result(HttpStatus.CONFLICT, ErrorCode.CONFLICT, 'Resource already exists');
    }
    if (exception.code === 'P2025') {
      return result(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Resource not found');
    }
  }

  return result(
    HttpStatus.INTERNAL_SERVER_ERROR,
    ErrorCode.INTERNAL_ERROR,
    'Internal server error',
    undefined,
    true,
  );
}
