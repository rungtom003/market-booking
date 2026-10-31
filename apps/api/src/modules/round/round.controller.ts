import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentRoundResponse } from '@market-booking/shared';
import { CurrentVendor } from '../auth/decorators';
import type { VendorPrincipal } from '../auth/principal';
import { RequireApprovedVendor } from '../vendor/vendor-approved.guard';
import { RoundService } from './round.service';

@ApiTags('rounds')
@ApiBearerAuth()
@RequireApprovedVendor()
@Controller('rounds')
export class RoundController {
  constructor(private readonly rounds: RoundService) {}

  @Get('current')
  @ApiOperation({
    summary: 'รอบที่เปิดจองอยู่หรือรอบถัดไป + เวลา server (ให้ Countdown ไม่ขึ้นกับนาฬิกาเครื่อง)',
  })
  current(@CurrentVendor() vendor: VendorPrincipal): Promise<CurrentRoundResponse> {
    return this.rounds.current(vendor.marketId);
  }
}
