import { Module } from '@nestjs/common';
import { PrivacyAdminController, PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { RetentionProcessor } from './retention.processor';
import { RetentionService } from './retention.service';

/** PDPA (Phase 11.3): สำเนาข้อมูล, ลบข้อมูลส่วนบุคคล, ลบข้อมูลตามระยะเวลาเก็บ */
@Module({
  controllers: [PrivacyController, PrivacyAdminController],
  providers: [PrivacyService, RetentionService, RetentionProcessor],
})
export class PrivacyModule {}
