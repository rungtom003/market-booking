import { Injectable } from '@nestjs/common';
import {
  type OccupancyReport,
  type OccupancyReportQuery,
  type OccupancyRow,
  type RevenueReport,
  type RevenueReportQuery,
  type RevenueRow,
  type VendorReport,
  type VendorReportQuery,
  type VendorReportRow,
  VENDOR_STATUS_TH,
} from '@market-booking/shared';
import { AuditService } from '../audit/audit.service';
import type { AdminPrincipal } from '../auth/principal';
import { type ReportColumn, type ReportFile, toReportFile } from './report-file';

const MONEY = '#,##0.00';
const GROUP_TH = { day: 'วันขาย', round: 'รอบ', zone: 'โซน' } as const;

/** ไฟล์ xlsx/csv ของรายงาน — ทุกการดาวน์โหลดลง audit log (`report.export`) */
@Injectable()
export class ReportExportService {
  constructor(private readonly audit: AuditService) {}

  async revenue(admin: AdminPrincipal, r: RevenueReport, q: RevenueReportQuery) {
    const columns: ReportColumn<RevenueRow>[] = [
      { header: GROUP_TH[r.groupBy], width: 24, value: (x) => x.label },
      { header: 'การจองที่ชำระแล้ว', value: (x) => x.bookings },
      { header: 'พร้อมเพย์ (บาท)', numFmt: MONEY, value: (x) => x.promptpay },
      { header: 'เงินสด (บาท)', numFmt: MONEY, value: (x) => x.cash },
      { header: 'รายได้รวม (บาท)', numFmt: MONEY, width: 16, value: (x) => x.revenue },
    ];
    const file = await toReportFile(
      q.format as 'xlsx' | 'csv',
      `revenue-${r.groupBy}-${r.from}_${r.to}`,
      'รายได้',
      columns,
      r.rows,
      { key: '', label: 'รวม', ...r.total },
    );
    return this.logged(admin, file, 'revenue', q, r.rows.length);
  }

  async occupancy(admin: AdminPrincipal, r: OccupancyReport, q: OccupancyReportQuery) {
    const columns: ReportColumn<OccupancyRow>[] = [
      { header: GROUP_TH[r.groupBy], width: 24, value: (x) => x.label },
      { header: 'ล็อคที่ใช้ได้', value: (x) => x.capacity },
      { header: 'จองสำเร็จ', value: (x) => x.confirmed },
      { header: 'รอชำระ/ตรวจ', value: (x) => x.pending },
      { header: 'อัตราการจอง', numFmt: '0.0%', value: (x) => x.rate },
    ];
    const file = await toReportFile(
      q.format as 'xlsx' | 'csv',
      `occupancy-${r.groupBy}-${r.from}_${r.to}`,
      'การใช้ล็อค',
      columns,
      r.rows,
      { key: '', label: 'รวม', ...r.total },
    );
    return this.logged(admin, file, 'occupancy', q, r.rows.length);
  }

  async vendors(admin: AdminPrincipal, r: VendorReport, q: VendorReportQuery) {
    const columns: ReportColumn<VendorReportRow>[] = [
      { header: 'ชื่อผู้ค้า', width: 28, value: (x) => x.name },
      { header: 'ชื่อร้าน', width: 24, value: (x) => x.shopName },
      { header: 'เบอร์โทร', value: (x) => x.phone },
      { header: 'สถานะ', value: (x) => VENDOR_STATUS_TH[x.status] },
      { header: 'จองสำเร็จ', value: (x) => x.bookings },
      { header: 'ยกเลิก/ไม่ชำระ', value: (x) => x.cancelled },
      { header: 'รายได้ (บาท)', numFmt: MONEY, value: (x) => x.revenue },
      { header: 'ไม่มาขาย (สะสม)', value: (x) => x.noshowCount },
    ];
    const file = await toReportFile(
      q.format as 'xlsx' | 'csv',
      `vendors-${r.sort}-${r.from}_${r.to}`,
      'ผู้ค้า',
      columns,
      r.rows,
    );
    return this.logged(admin, file, 'vendors', q, r.rows.length, r.phoneMasked);
  }

  private async logged(
    admin: AdminPrincipal,
    file: ReportFile,
    report: string,
    query: object,
    rows: number,
    phoneMasked?: boolean,
  ): Promise<ReportFile> {
    await this.audit.log({
      actorType: 'ADMIN',
      actorId: admin.id,
      action: 'report.export',
      entity: { type: 'report' },
      after: { report, ...query, rows, ...(phoneMasked !== undefined && { phoneMasked }) },
    });
    return file;
  }
}
