import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ErrorCode } from '@market-booking/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../exceptions/app.exception';
import { toErrorResponse } from './to-error-response';

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('db error with internal details', {
    code,
    clientVersion: 'test',
  });
}

describe('toErrorResponse', () => {
  it('uses code, status, message and details from AppException', () => {
    const details = { stallId: 's1' };
    const res = toErrorResponse(new AppException(ErrorCode.STALL_TAKEN, 'Stall taken', details));

    expect(res).toEqual({
      status: 409,
      body: { error: { code: 'STALL_TAKEN', message: 'Stall taken', details } },
      unexpected: false,
    });
  });

  it('defaults the AppException message to its code and omits empty details', () => {
    const res = toErrorResponse(new AppException(ErrorCode.VENDOR_SUSPENDED));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'VENDOR_SUSPENDED', message: 'VENDOR_SUSPENDED' } });
  });

  it.each([
    [new BadRequestException('bad'), 400, 'BAD_REQUEST'],
    [new UnauthorizedException(), 401, 'UNAUTHORIZED'],
    [new ForbiddenException(), 403, 'FORBIDDEN'],
    [new NotFoundException('Cannot GET /nope'), 404, 'NOT_FOUND'],
  ])('maps Nest HttpException %#', (exception, status, code) => {
    const res = toErrorResponse(exception);

    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(res.unexpected).toBe(false);
  });

  it('joins array messages from Nest exceptions', () => {
    const res = toErrorResponse(
      new BadRequestException({ message: ['a is required', 'b too long'] }),
    );

    expect(res.body.error.message).toBe('a is required; b too long');
  });

  it('maps throttling to 429 RATE_LIMITED', () => {
    const res = toErrorResponse(new ThrottlerException());

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('maps malformed JSON bodies (body-parser) to 400 BAD_REQUEST', () => {
    const parseError = Object.assign(new SyntaxError('Unexpected token'), {
      type: 'entity.parse.failed',
      status: 400,
    });

    expect(toErrorResponse(parseError)).toMatchObject({
      status: 400,
      body: { error: { code: 'BAD_REQUEST', message: 'Malformed request body' } },
    });
  });

  it.each([
    ['P2002', 409, 'CONFLICT'],
    ['P2025', 404, 'NOT_FOUND'],
  ])('maps Prisma %s without leaking the DB message', (code, status, errorCode) => {
    const res = toErrorResponse(prismaError(code));

    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(errorCode);
    expect(res.body.error.message).not.toMatch(/internal details/);
  });

  it.each([
    ['plain Error', new Error('secret connection string')],
    ['5xx HttpException', new InternalServerErrorException('secret stack info')],
    ['unknown Prisma error', prismaError('P1001')],
    ['non-error value', 'boom'],
  ])('hides %s behind 500 INTERNAL_ERROR and flags it for logging', (_name, exception) => {
    const res = toErrorResponse(exception);

    expect(res).toEqual({
      status: 500,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      unexpected: true,
    });
  });
});
