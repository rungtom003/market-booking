import { Module } from '@nestjs/common';
import { BookingCoreModule } from '../booking/booking-core.module';
import { SettingsModule } from '../settings/settings.module';
import { VendorModule } from '../vendor/vendor.module';
import { PaymentReviewService } from './payment-review.service';
import { PaymentAdminController, PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { AppConfigService } from '../../config/app-config.service';
import { ManualSlipVerifier, SLIP_VERIFIER } from './slip-verifier';
import { SlipOkVerifier } from './slipok.verifier';

/** ชำระเงิน (Phase 5.1): PromptPay QR, สลิป, ตรวจ/อนุมัติ, เงินสด — ตรวจสลิปอัตโนมัติผ่าน SLIP_VERIFIER (env, 11.2) */
@Module({
  imports: [BookingCoreModule, SettingsModule, VendorModule],
  controllers: [PaymentController, PaymentAdminController],
  providers: [
    PaymentService,
    PaymentReviewService,
    ManualSlipVerifier,
    SlipOkVerifier,
    {
      provide: SLIP_VERIFIER,
      inject: [AppConfigService, ManualSlipVerifier, SlipOkVerifier],
      useFactory: (config: AppConfigService, manual: ManualSlipVerifier, slipok: SlipOkVerifier) =>
        config.get('SLIP_VERIFIER') === 'slipok' ? slipok : manual,
    },
  ],
})
export class PaymentModule {}
