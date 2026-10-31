import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MarketDayStalls, MarketLayout } from '@market-booking/shared';
import { CurrentVendor } from '../auth/decorators';
import type { VendorPrincipal } from '../auth/principal';
import { RequireApprovedVendor } from '../vendor/vendor-approved.guard';
import { MarketLayoutService } from './market-layout.service';

/** ผังตลาดสำหรับผู้ค้าที่อนุมัติแล้ว (ตลาดของตัวเองเท่านั้น) */
@ApiTags('market layout')
@ApiBearerAuth()
@RequireApprovedVendor()
@Controller()
export class MarketLayoutController {
  constructor(private readonly layout: MarketLayoutService) {}

  @Get('market/layout')
  @ApiOperation({ summary: 'ผังตลาด (โซน + ล็อคที่เปิดใช้งาน) — ดูได้ก่อนเปิดรอบจอง' })
  marketLayout(@CurrentVendor() vendor: VendorPrincipal): Promise<MarketLayout> {
    return this.layout.layout(vendor.marketId);
  }

  @Get('market-days/:id/stalls')
  @ApiOperation({ summary: 'ผังของวันขาย (ราคา/ปิดล็อคตามวัน) — Phase 4 เพิ่มสถานะการจอง' })
  marketDayStalls(
    @CurrentVendor() vendor: VendorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MarketDayStalls> {
    return this.layout.marketDayStalls(vendor.marketId, id);
  }
}
