import { Module } from '@nestjs/common';
import { BookingCoreModule } from '../booking/booking-core.module';
import { SettingsModule } from '../settings/settings.module';
import { VendorModule } from '../vendor/vendor.module';
import { WaitlistOfferService } from './waitlist-offer.service';
import { WaitlistAdminController, WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';

/** คิวรอล็อค (Phase 9.2) — เข้า/ออกคิว + ส่งสิทธิ์อัตโนมัติเมื่อล็อคว่าง */
@Module({
  imports: [BookingCoreModule, SettingsModule, VendorModule],
  controllers: [WaitlistController, WaitlistAdminController],
  providers: [WaitlistService, WaitlistOfferService],
  exports: [WaitlistOfferService],
})
export class WaitlistModule {}
