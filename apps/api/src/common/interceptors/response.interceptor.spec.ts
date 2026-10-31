import { CallHandler, ExecutionContext, StreamableFile } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { PaginatedResult } from '../pagination/paginated-result';
import { ResponseInterceptor } from './response.interceptor';

const httpContext = { getType: () => 'http' } as ExecutionContext;
const handlerReturning = (value: unknown): CallHandler => ({ handle: () => of(value) });

describe('ResponseInterceptor', () => {
  const interceptor = new ResponseInterceptor();
  const run = (value: unknown) =>
    lastValueFrom(interceptor.intercept(httpContext, handlerReturning(value)));

  it('wraps plain values in { data }', async () => {
    await expect(run({ id: 1 })).resolves.toEqual({ data: { id: 1 } });
    await expect(run([1, 2])).resolves.toEqual({ data: [1, 2] });
  });

  it('turns undefined (void handlers) into data: null', async () => {
    await expect(run(undefined)).resolves.toEqual({ data: null });
  });

  it('unpacks PaginatedResult into data + meta', async () => {
    const page = PaginatedResult.of(['a'], 1, { page: 1, pageSize: 20 });

    await expect(run(page)).resolves.toEqual({
      data: ['a'],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
  });

  it('leaves files untouched', async () => {
    const file = new StreamableFile(Buffer.from('x'));

    await expect(run(file)).resolves.toBe(file);
  });
});
