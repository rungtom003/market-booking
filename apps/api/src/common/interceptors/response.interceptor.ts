import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import type { ApiResponse } from '@market-booking/shared';
import { Observable, map } from 'rxjs';
import { PaginatedResult } from '../pagination/paginated-result';

/** ห่อผลลัพธ์ของทุก controller เป็น `{ data, meta? }` (Overview §11) */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    return next.handle().pipe(
      map((value: unknown): ApiResponse<unknown> | StreamableFile => {
        // ไฟล์ (เช่น export xlsx) ส่งตรง ไม่ห่อ
        if (value instanceof StreamableFile) return value;
        if (value instanceof PaginatedResult) return { data: value.items, meta: value.meta };
        return { data: value ?? null };
      }),
    );
  }
}
