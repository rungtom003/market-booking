import { Module } from '@nestjs/common';
import { BookingCoreModule } from '../booking/booking-core.module';
import { SettingsModule } from '../settings/settings.module';
import { VendorModule } from '../vendor/vendor.module';
import { CheckinAdminController, CheckinVendorController } from './checkin.controller';
import { CheckinService } from './checkin.service';
import { NoShowProcessor } from './noshow.processor';
import { NoShowService } from './noshow.service';

/** Check-in หน้างาน + นับ No-show (Phase 10) */
@Module({
  imports: [BookingCoreModule, SettingsModule, VendorModule],
  controllers: [CheckinVendorController, CheckinAdminController],
  providers: [CheckinService, NoShowService, NoShowProcessor],
})
export class CheckinModule {}
