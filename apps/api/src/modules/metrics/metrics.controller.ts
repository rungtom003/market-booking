import { timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ErrorCode } from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../auth/decorators';
import { NotificationService } from '../notify/notification.service';
import { MetricsService } from './metrics.service';

/** ตรวจ `Authorization: Bearer <token>` แบบเวลาคงที่ — ไม่ตั้ง token = ปิด endpoint (404) */
function assertBearer(header: string | undefined, token: string | undefined): void {
  if (!token) throw new AppException(ErrorCode.NOT_FOUND, 'Not found');
  const got = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '');
  const want = Buffer.from(token);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    throw new AppException(ErrorCode.UNAUTHORIZED, 'Invalid token');
  }
}

/** payload ของ Alertmanager webhook (เฉพาะ field ที่ใช้) */
interface AlertmanagerPayload {
  alerts?: {
    status?: string;
    fingerprint?: string;
    startsAt?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  }[];
}

/**
 * Monitoring (Phase 11.4) — ใช้จากใน docker network เท่านั้น (nginx ไม่ส่ง path เหล่านี้ออกภายนอก)
 * - `GET /api/v1/metrics` — Prometheus scrape (`METRICS_TOKEN`)
 * - `POST /api/v1/internal/alerts` — Alertmanager ส่ง alert → LINE กลุ่มเจ้าหน้าที่ (`ALERT_WEBHOOK_TOKEN`)
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller()
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  @Get('metrics')
  async scrape(@Headers('authorization') auth?: string): Promise<StreamableFile> {
    assertBearer(auth, this.config.get('METRICS_TOKEN'));
    const { body, contentType } = await this.metrics.render();
    return new StreamableFile(Buffer.from(body), { type: contentType });
  }

  @Post('internal/alerts')
  @HttpCode(HttpStatus.NO_CONTENT)
  async alert(
    @Headers('authorization') auth: string | undefined,
    @Body() body: AlertmanagerPayload,
  ): Promise<void> {
    assertBearer(auth, this.config.get('ALERT_WEBHOOK_TOKEN'));
    const markets = await this.prisma.market.findMany({ select: { id: true } });
    for (const a of body.alerts ?? []) {
      const status = a.status === 'resolved' ? 'resolved' : 'firing';
      this.metrics.alertsReceived.inc({ status });
      const params = {
        status,
        name: a.labels?.alertname ?? 'alert',
        summary: a.annotations?.summary ?? a.labels?.alertname ?? '-',
        description: a.annotations?.description ?? null,
      } as const;
      for (const market of markets) {
        await this.notifications.toAdminGroup(
          market.id,
          { template: 'admin.alert', params },
          `alert:${a.fingerprint ?? params.name}:${a.startsAt ?? ''}:${status}`,
        );
      }
    }
  }
}
