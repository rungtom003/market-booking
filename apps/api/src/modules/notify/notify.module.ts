import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { BookingCoreModule } from '../booking/booking-core.module';
import { SettingsModule } from '../settings/settings.module';
import { LineMessagingProvider } from './line/line-messaging.provider';
import { LineWebhookController } from './line/line-webhook.controller';
import { NotificationReminders } from './notification-reminders';
import { NotificationQueue } from './notification.queue';
import { NotificationService } from './notification.service';
import { NotifyService } from './notify.service';
import { MockSmsProvider } from './sms/mock-sms.provider';
import { SMS_PROVIDER } from './sms/sms.provider';
import { ThaiBulkSmsProvider } from './sms/thaibulksms.provider';

/**
 * แจ้งเตือน (Phase 7): queue `notification` + notification_logs, LINE OA (Messaging API), SMS
 * SMS provider เลือกจาก env `SMS_PROVIDER` — OTP เรียก SMS_PROVIDER ตรง (ต้องรู้ผลทันที ไม่ผ่าน queue)
 */
@Global()
@Module({
  imports: [BookingCoreModule, SettingsModule],
  controllers: [LineWebhookController],
  providers: [
    NotifyService,
    NotificationService,
    NotificationQueue,
    NotificationReminders,
    LineMessagingProvider,
    MockSmsProvider,
    ThaiBulkSmsProvider,
    {
      provide: SMS_PROVIDER,
      inject: [AppConfigService, MockSmsProvider, ThaiBulkSmsProvider],
      useFactory: (config: AppConfigService, mock: MockSmsProvider, real: ThaiBulkSmsProvider) =>
        config.get('SMS_PROVIDER') === 'thaibulksms' ? real : mock,
    },
  ],
  exports: [NotifyService, NotificationService, SMS_PROVIDER],
})
export class NotifyModule {}
