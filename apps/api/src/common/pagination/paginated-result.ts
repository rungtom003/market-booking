import type { PaginationMeta, PaginationQuery } from '@market-booking/shared';

/**
 * คืนค่านี้จาก controller แทน array เมื่อเป็นรายการแบบแบ่งหน้า —
 * ResponseInterceptor แปลงเป็น `{ data: items, meta }`
 */
export class PaginatedResult<T> {
  constructor(
    readonly items: T[],
    readonly meta: PaginationMeta,
  ) {}

  static of<T>(items: T[], total: number, query: PaginationQuery): PaginatedResult<T> {
    return new PaginatedResult(items, {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    });
  }
}

/** แปลง page/pageSize เป็น skip/take ของ Prisma */
export function toSkipTake(query: PaginationQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}
