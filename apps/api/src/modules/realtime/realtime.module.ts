import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { RoundModule } from '../round/round.module';
import { VendorModule } from '../vendor/vendor.module';
import { RealtimeGateway } from './realtime.gateway';

/** Socket.IO (Phase 4.3) — แปลง event ภายใน (booking/round/vendor) เป็น event ถึง client */
@Module({
  imports: [BookingModule, RoundModule, VendorModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
