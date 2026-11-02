import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { VendorModule } from '../vendor/vendor.module';
import { WaitingRoomAdminController, WaitingRoomController } from './waiting-room.controller';
import { WaitingRoomProcessor } from './waiting-room.processor';
import { WaitingRoomService } from './waiting-room.service';

/** Waiting Room ต่อรอบ (Phase 11.1) — BookingModule ใช้ตรวจสิทธิ์ตอน HOLD, Realtime แจ้ง "ได้เข้าแล้ว" */
@Module({
  imports: [SettingsModule, VendorModule],
  controllers: [WaitingRoomController, WaitingRoomAdminController],
  providers: [WaitingRoomService, WaitingRoomProcessor],
  exports: [WaitingRoomService],
})
export class WaitingRoomModule {}
