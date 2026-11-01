import { Module } from '@nestjs/common';
import { AnnouncementAdminController, AnnouncementController } from './announcement.controller';
import { AnnouncementService } from './announcement.service';

/** ประกาศของตลาด (Phase 9.3) — การส่ง LINE อยู่ใน NotificationReminders */
@Module({
  controllers: [AnnouncementController, AnnouncementAdminController],
  providers: [AnnouncementService],
})
export class AnnouncementModule {}
