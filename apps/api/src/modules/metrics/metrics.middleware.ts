import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/** ไม่นับ (scrape/health ถี่ — ทำให้กราฟเพี้ยน) */
const SKIP = /\/(metrics|health)(\/|$)/;

/**
 * วัดเวลาตอบทุก request — label `route` ใช้รูปแบบ path ที่ match (`/api/v1/bookings/:id/confirm`)
 * ไม่ใช่ path จริง (id ต่างกันจะทำให้ series บวมไม่จำกัด); ไม่ match route = `unmatched`
 */
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (SKIP.test(req.originalUrl)) return next();
    const end = this.metrics.httpDuration.startTimer();
    res.once('finish', () => {
      const route = req.route as { path?: string } | undefined;
      end({
        method: req.method,
        route: route?.path ? `${req.baseUrl}${route.path}` : 'unmatched',
        status: String(res.statusCode),
      });
    });
    next();
  }
}
