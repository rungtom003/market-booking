import { paginationQuerySchema } from '@market-booking/shared';
import { PaginatedResult, toSkipTake } from './paginated-result';

describe('pagination', () => {
  it('parses query strings with defaults and limits', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
    });
    expect(paginationQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('converts page/pageSize to skip/take', () => {
    expect(toSkipTake({ page: 1, pageSize: 20 })).toEqual({ skip: 0, take: 20 });
    expect(toSkipTake({ page: 3, pageSize: 25 })).toEqual({ skip: 50, take: 25 });
  });

  it('builds meta with totalPages rounded up', () => {
    const result = PaginatedResult.of(['a', 'b'], 41, { page: 2, pageSize: 20 });

    expect(result.items).toEqual(['a', 'b']);
    expect(result.meta).toEqual({ page: 2, pageSize: 20, total: 41, totalPages: 3 });
  });

  it('reports 0 pages for an empty result', () => {
    expect(PaginatedResult.of([], 0, { page: 1, pageSize: 20 }).meta.totalPages).toBe(0);
  });
});
