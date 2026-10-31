import { Module } from '@nestjs/common';
import { MarketSetupModule } from '../market-setup/market-setup.module';
import { RoundModule } from '../round/round.module';
import { SettingsModule } from '../settings/settings.module';
import { VendorModule } from '../vendor/vendor.module';
import { BookingCoreModule } from './booking-core.module';
import { BookingExpiryProcessor } from './booking-expiry.processor';
import { BookingAdminController, BookingAdminDayController } from './booking-admin.controller';
import { BookingAdminService } from './booking-admin.service';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';

/** การจองล็อค (4.1) + queue หมดเวลา (4.2) + จัดการการจองฝั่ง admin (4.5) — event อยู่ใน BookingCoreModule */
@Module({
  imports: [BookingCoreModule, MarketSetupModule, RoundModule, SettingsModule, VendorModule],
  controllers: [BookingController, BookingAdminController, BookingAdminDayController],
  providers: [BookingService, BookingAdminService, BookingExpiryProcessor],
  exports: [BookingCoreModule],
})
export class BookingModule {}
