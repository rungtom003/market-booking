import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { HealthStatus } from '@market-booking/shared';
import { Public } from '../auth/decorators';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  // uptime monitor เรียกถี่ ไม่ควรโดน rate limit
  @SkipThrottle()
  @Get()
  @ApiOkResponse({ description: '`{ data: { status: "ok", uptime, timestamp } }`' })
  check(): HealthStatus {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
