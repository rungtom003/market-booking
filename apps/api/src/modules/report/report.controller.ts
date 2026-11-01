import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  type AuditLogEntry,
  type Dashboard,
  type OccupancyReport,
  type RevenueReport,
  type VendorReport,
  Permission,
  auditLogQuerySchema,
  hasPermission,
  occupancyReportQuerySchema,
  revenueReportQuerySchema,
  vendorReportQuerySchema,
} from '@market-booking/shared';
import { createZodDto } from 'nestjs-zod';
import { PaginatedResult } from '../../common/pagination/paginated-result';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentAdmin, RequirePermission } from '../auth/decorators';
import type { AdminPrincipal } from '../auth/principal';
import { MarketService } from '../market/market.service';
import { AuditLogService } from './audit-log.service';
import { ReportExportService } from './report-export.service';
import type { ReportFile } from './report-file';
import { ReportService } from './report.service';

class RevenueQueryDto extends createZodDto(revenueReportQuerySchema) {}
class OccupancyQueryDto extends createZodDto(occupancyReportQuerySchema) {}
class VendorQueryDto extends createZodDto(vendorReportQuerySchema) {}
class AuditLogQueryDto extends createZodDto(auditLogQuerySchema) {}

const FILE_TYPES = [
  'application/json',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
];

function download(file: ReportFile): StreamableFile {
  return new StreamableFile(file.buffer, {
    type: file.contentType,
    disposition: `attachment; filename="${file.filename}"`,
  });
}

@ApiTags('admin / reports')
@ApiBearerAuth()
@RequirePermission(Permission.REPORTS_VIEW)
@Controller('admin/reports')
export class ReportController {
  constructor(
    private readonly reports: ReportService,
    private readonly exports: ReportExportService,
    private readonly markets: MarketService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'ผู้ค้ารออนุมัติ, สลิปรอตรวจ, อัตราการจองและรายได้ของรอบปัจจุบัน' })
  async dashboard(@CurrentAdmin() admin: AdminPrincipal): Promise<Dashboard> {
    return this.reports.dashboard(await this.markets.resolveForAdmin(admin));
  }

  @Get('revenue')
  @ApiProduces(...FILE_TYPES)
  @ApiOperation({
    summary: 'รายได้ (ยอดชำระที่อนุมัติ) ตามวันขาย/รอบ/โซน — format=xlsx|csv ดาวน์โหลด',
  })
  async revenue(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() q: RevenueQueryDto,
  ): Promise<RevenueReport | StreamableFile> {
    const report = await this.reports.revenue(await this.markets.resolveForAdmin(admin), q);
    return q.format === 'json' ? report : download(await this.exports.revenue(admin, report, q));
  }

  @Get('occupancy')
  @ApiProduces(...FILE_TYPES)
  @ApiOperation({ summary: 'การใช้ล็อค (จองสำเร็จ/ล็อคที่ใช้ได้) ตามวันขาย/โซน' })
  async occupancy(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() q: OccupancyQueryDto,
  ): Promise<OccupancyReport | StreamableFile> {
    const report = await this.reports.occupancy(await this.markets.resolveForAdmin(admin), q);
    return q.format === 'json' ? report : download(await this.exports.occupancy(admin, report, q));
  }

  @Get('vendors')
  @ApiProduces(...FILE_TYPES)
  @ApiOperation({
    summary:
      'ผู้ค้า Top (จอง/รายได้) และยกเลิก/ไม่มาขาย — เบอร์โทรปิดบางส่วนถ้าไม่มี VENDOR_PHONE_VIEW',
  })
  async vendors(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() q: VendorQueryDto,
  ): Promise<VendorReport | StreamableFile> {
    const report = await this.reports.vendors(
      await this.markets.resolveForAdmin(admin),
      q,
      hasPermission(admin.role, Permission.VENDOR_PHONE_VIEW),
    );
    return q.format === 'json' ? report : download(await this.exports.vendors(admin, report, q));
  }
}

@ApiTags('admin / audit logs')
@ApiBearerAuth()
@RequirePermission(Permission.AUDIT_LOG_VIEW)
@Controller('admin/audit-logs')
export class AuditLogController {
  constructor(
    private readonly logs: AuditLogService,
    private readonly markets: MarketService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'audit log ใหม่สุดก่อน — กรอง actor/action (ลงท้าย "." = ทั้งกลุ่ม)/entity/วันที่ (เวลาตลาด)',
  })
  async list(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() q: AuditLogQueryDto,
  ): Promise<PaginatedResult<AuditLogEntry>> {
    const market = await this.prisma.market.findUniqueOrThrow({
      where: { id: await this.markets.resolveForAdmin(admin) },
      select: { timezone: true },
    });
    return this.logs.list(q, market.timezone);
  }

  @Get('actions')
  @ApiOperation({ summary: 'action ทั้งหมดที่มีใน log (ตัวเลือกของ filter)' })
  actions(): Promise<string[]> {
    return this.logs.actions();
  }
}
