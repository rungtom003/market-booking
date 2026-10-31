import { Global, Module } from '@nestjs/common';
import { MockSmsProvider } from './sms/mock-sms.provider';
import { SMS_PROVIDER } from './sms/sms.provider';

/**
 * ช่องทางแจ้งเตือน (SMS, LINE) — Phase 7 เพิ่ม queue, template และผู้ให้บริการจริง
 * เลือก SMS provider จาก env `SMS_PROVIDER` (ตอนนี้มีแค่ `mock`)
 */
@Global()
@Module({
  providers: [MockSmsProvider, { provide: SMS_PROVIDER, useExisting: MockSmsProvider }],
  exports: [SMS_PROVIDER],
})
export class NotifyModule {}
