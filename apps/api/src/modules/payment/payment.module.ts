import { Module } from '@nestjs/common';
import { BookingCoreModule } from '../booking/booking-core.module';
import { SettingsModule } from '../settings/settings.module';
import { VendorModule } from '../vendor/vendor.module';
import { PaymentReviewService } from './payment-review.service';
import { PaymentAdminController, PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { ManualSlipVerifier, SLIP_VERIFIER } from './slip-verifier';

/** ชำระเงิน (Phase 5.1): PromptPay QR, สลิป, ตรวจ/อนุมัติ, เงินสด — ตรวจสลิปอัตโนมัติผ่าน SLIP_VERIFIER */
@Module({
  imports: [BookingCoreModule, SettingsModule, VendorModule],
  controllers: [PaymentController, PaymentAdminController],
  providers: [
    PaymentService,
    PaymentReviewService,
    { provide: SLIP_VERIFIER, useClass: ManualSlipVerifier },
  ],
})
export class PaymentModule {}
