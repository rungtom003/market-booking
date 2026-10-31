import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;

/** query string `?page=&pageSize=` ของทุก endpoint ที่เป็นรายการ */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** `meta` ของ response แบบรายการ */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
