import { Module } from '@nestjs/common';
import { RoundModule } from '../round/round.module';
import { SettingsModule } from '../settings/settings.module';
import { VendorModule } from '../vendor/vendor.module';
import { BookingEvents } from './booking-events';
import { BookingExpiryProcessor } from './booking-expiry.processor';
import { BookingStateService } from './booking-state.service';
import { BookingAdminController, BookingController } from './booking.controller';
import { BookingService } from './booking.service';

/** การจองล็อค (Phase 4.1) + queue หมดเวลา (4.2) — `BookingEvents` ให้ 4.3 (realtime) subscribe */
@Module({
  imports: [RoundModule, SettingsModule, VendorModule],
  controllers: [BookingController, BookingAdminController],
  providers: [BookingService, BookingStateService, BookingEvents, BookingExpiryProcessor],
  exports: [BookingEvents, BookingStateService],
})
export class BookingModule {}
