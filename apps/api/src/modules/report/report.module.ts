import { Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { ReportExportService } from './report-export.service';
import { AuditLogController, ReportController } from './report.controller';
import { ReportService } from './report.service';

/** Dashboard, รายงาน (รายได้/การใช้ล็อค/ผู้ค้า) + export และหน้าค้น audit log (Phase 8) */
@Module({
  controllers: [ReportController, AuditLogController],
  providers: [ReportService, ReportExportService, AuditLogService],
})
export class ReportModule {}
