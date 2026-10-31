import { ErrorCode } from '@market-booking/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AppException } from '../exceptions/app.exception';
import { ZodValidationPipe } from './zod-validation.pipe';

class CreateThingDto extends createZodDto(
  z.object({
    name: z.string().min(1),
    price: z.coerce.number().positive(),
    tags: z.array(z.string()).max(2).default([]),
  }),
) {}

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe();
  const meta = { type: 'body' as const, metatype: CreateThingDto };

  it('returns the parsed value (coercion + defaults applied)', () => {
    expect(pipe.transform({ name: 'A1', price: '150' }, meta)).toEqual({
      name: 'A1',
      price: 150,
      tags: [],
    });
  });

  it('throws VALIDATION_ERROR with one issue per invalid field', () => {
    let error: unknown;
    try {
      pipe.transform({ name: '', price: -1, tags: ['a', 'b', 'c'] }, meta);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(AppException);
    const appError = error as AppException;
    expect(appError.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(appError.getStatus()).toBe(400);
    expect((appError.details as { path: string }[]).map((d) => d.path).sort()).toEqual([
      'name',
      'price',
      'tags',
    ]);
  });

  it('passes through parameters that are not Zod DTOs', () => {
    const value = { anything: true };

    expect(pipe.transform(value, { type: 'body', metatype: Object })).toBe(value);
  });
});
