import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { VendorModule } from '../vendor/vendor.module';
import { MarketDayService } from './market-day.service';
import { RoundEvents } from './round-events';
import { MarketDayAdminController, RoundAdminController } from './round-admin.controller';
import { RoundController } from './round.controller';
import { RoundService } from './round.service';

/** รอบการจอง วันขาย และ override ล็อครายวัน (Phase 3.2) — `RoundService.assertRoundOpen` ใช้ตอนจอง */
@Module({
  imports: [SettingsModule, VendorModule],
  controllers: [RoundAdminController, MarketDayAdminController, RoundController],
  providers: [RoundService, MarketDayService, RoundEvents],
  exports: [RoundService, RoundEvents],
})
export class RoundModule {}
