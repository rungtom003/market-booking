import { Controller, Get } from '@nestjs/common';
import type { HealthStatus } from '@market-booking/shared';

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthStatus {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
