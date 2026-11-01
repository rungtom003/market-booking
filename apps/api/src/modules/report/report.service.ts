import { Injectable } from '@nestjs/common';
import {
  type Dashboard,
  type DashboardRound,
  type OccupancyReport,
  type OccupancyReportQuery,
  type OccupancyRow,
  type RevenueReport,
  type RevenueReportQuery,
  type RevenueRow,
  type VendorReport,
  type VendorReportQuery,
  type VendorReportRow,
  type VendorStatus,
  formatIsoDateTh,
  maskPhone,
  roundPhase,
} from '@market-booking/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** ช่วงวันขาย (รวมทั้งสองวัน) + รอบ — ทุกส่วนเป็น optional สำหรับ dashboard ที่ดูทั้งรอบ */
interface DayFilter {
  from?: string;
  to?: string;
  roundId?: string;
}

/** เงื่อนไขของ market_days (alias `md`) */
function dayWhere(marketId: string, f: DayFilter): Prisma.Sql {
  return Prisma.sql`md.market_id = ${marketId}::uuid
    AND NOT md.is_cancelled
    ${f.from ? Prisma.sql`AND md.market_date >= ${f.from}::date` : Prisma.empty}
    ${f.to ? Prisma.sql`AND md.market_date <= ${f.to}::date` : Prisma.empty}
    ${f.roundId ? Prisma.sql`AND md.round_id = ${f.roundId}::uuid` : Prisma.empty}`;
}

const rate = (confirmed: number, capacity: number) =>
  capacity === 0 ? 0 : Math.round((confirmed / capacity) * 10_000) / 10_000;

const toNumber = (v: unknown) => Number(v ?? 0);

/**
 * รายงาน (Phase 8) — aggregate ใน PostgreSQL ด้วย SQL ตรง (GROUP BY หลายตาราง Prisma ทำไม่ได้)
 * ทุก query กรองด้วย market_id ของ admin และนับเฉพาะวันขายที่ไม่ถูกยกเลิก
 */
@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────── รายได้ ─────────────

  async revenue(marketId: string, q: RevenueReportQuery): Promise<RevenueReport> {
    const group = {
      day: Prisma.sql`md.market_date::text`,
      round: Prisma.sql`md.round_id::text`,
      zone: Prisma.sql`s.zone_id::text`,
    }[q.groupBy];
    const raw = await this.prisma.$queryRaw<
      { key: string; bookings: number; revenue: unknown; promptpay: unknown; cash: unknown }[]
    >`
      SELECT ${group} AS key,
        count(DISTINCT p.booking_id)::int AS bookings,
        sum(p.amount) AS revenue,
        coalesce(sum(p.amount) FILTER (WHERE p.method = 'PROMPTPAY_SLIP'), 0) AS promptpay,
        coalesce(sum(p.amount) FILTER (WHERE p.method = 'CASH'), 0) AS cash
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      JOIN market_days md ON md.id = b.market_day_id
      JOIN stalls s ON s.id = b.stall_id
      WHERE p.status = 'APPROVED' AND ${dayWhere(marketId, q)}
      GROUP BY 1`;

    const labels = await this.labels(
      q.groupBy,
      raw.map((r) => r.key),
    );
    const rows: RevenueRow[] = raw
      .map((r) => ({
        key: r.key,
        label: labels.get(r.key)?.label ?? r.key,
        bookings: r.bookings,
        revenue: toNumber(r.revenue),
        promptpay: toNumber(r.promptpay),
        cash: toNumber(r.cash),
      }))
      .sort((a, b) => this.order(labels, a.key, b.key));
    const sum = (k: 'bookings' | 'revenue' | 'promptpay' | 'cash') =>
      rows.reduce((acc, r) => acc + r[k], 0);
    return {
      groupBy: q.groupBy,
      from: q.from,
      to: q.to,
      rows,
      total: {
        bookings: sum('bookings'),
        revenue: sum('revenue'),
        promptpay: sum('promptpay'),
        cash: sum('cash'),
      },
    };
  }

  // ───────────── การใช้ล็อค ─────────────

  async occupancy(marketId: string, q: OccupancyReportQuery): Promise<OccupancyReport> {
    const raw = await this.occupancyRaw(marketId, q, q.groupBy);
    const labels = await this.labels(
      q.groupBy,
      raw.map((r) => r.key),
    );
    const rows: OccupancyRow[] = raw
      .map((r) => ({
        key: r.key,
        label: labels.get(r.key)?.label ?? r.key,
        capacity: r.capacity,
        confirmed: r.confirmed,
        pending: r.pending,
        rate: rate(r.confirmed, r.capacity),
      }))
      .sort((a, b) => this.order(labels, a.key, b.key));
    const capacity = rows.reduce((a, r) => a + r.capacity, 0);
    const confirmed = rows.reduce((a, r) => a + r.confirmed, 0);
    return {
      groupBy: q.groupBy,
      from: q.from,
      to: q.to,
      rows,
      total: {
        capacity,
        confirmed,
        pending: rows.reduce((a, r) => a + r.pending, 0),
        rate: rate(confirmed, capacity),
      },
    };
  }

  /**
   * ล็อคที่ใช้ได้ต่อวัน = ล็อคที่เปิดใช้งาน (ค่าปัจจุบัน) ลบที่ปิดเฉพาะวัน
   * (ไม่มีประวัติการเปิด/ปิดล็อคย้อนหลัง — ล็อคที่ลบ/ปิดใช้งานแล้วไม่นับในวันเก่า)
   */
  private occupancyRaw(marketId: string, f: DayFilter, groupBy: 'day' | 'zone' | 'all') {
    const group = {
      day: Prisma.sql`d.market_date::text`,
      zone: Prisma.sql`s.zone_id::text`,
      all: Prisma.sql`'all'`,
    }[groupBy];
    return this.prisma.$queryRaw<
      { key: string; capacity: number; confirmed: number; pending: number }[]
    >`
      WITH d AS (
        SELECT md.id, md.market_date FROM market_days md WHERE ${dayWhere(marketId, f)}
      ),
      slots AS (
        SELECT d.id AS day_id, d.market_date, s.id AS stall_id, s.zone_id
        FROM d
        CROSS JOIN stalls s
        LEFT JOIN stall_day_overrides o ON o.stall_id = s.id AND o.market_day_id = d.id
        WHERE s.market_id = ${marketId}::uuid AND s.is_active AND NOT coalesce(o.is_closed, false)
      ),
      bk AS (
        SELECT b.market_day_id AS day_id, b.stall_id,
          bool_or(b.status = 'CONFIRMED') AS confirmed,
          bool_or(b.status IN ('HOLD', 'PENDING_PAYMENT', 'PENDING_VERIFY')) AS pending
        FROM bookings b JOIN d ON d.id = b.market_day_id
        WHERE b.status IN ('HOLD', 'PENDING_PAYMENT', 'PENDING_VERIFY', 'CONFIRMED')
        GROUP BY 1, 2
      )
      SELECT ${group} AS key,
        count(*)::int AS capacity,
        count(*) FILTER (WHERE bk.confirmed)::int AS confirmed,
        count(*) FILTER (WHERE bk.pending AND NOT bk.confirmed)::int AS pending
      FROM slots s
      JOIN d ON d.id = s.day_id
      LEFT JOIN bk ON bk.day_id = s.day_id AND bk.stall_id = s.stall_id
      GROUP BY 1`;
  }

  // ───────────── ผู้ค้า ─────────────

  async vendors(
    marketId: string,
    q: VendorReportQuery,
    canViewPhone: boolean,
  ): Promise<VendorReport> {
    const order = {
      bookings: Prisma.sql`bookings DESC, revenue DESC`,
      revenue: Prisma.sql`revenue DESC, bookings DESC`,
      cancelled: Prisma.sql`cancelled DESC, bookings DESC`,
      noshow: Prisma.sql`v.noshow_count DESC, bookings DESC`,
    }[q.sort];
    const raw = await this.prisma.$queryRaw<
      {
        id: string;
        first_name: string;
        last_name: string;
        shop_name: string | null;
        phone: string;
        status: VendorStatus;
        noshow_count: number;
        bookings: number;
        cancelled: number;
        revenue: unknown;
      }[]
    >`
      WITH b AS (
        SELECT b.vendor_id,
          count(*) FILTER (WHERE b.status = 'CONFIRMED') AS bookings,
          -- หมดเวลาเฉพาะที่ผ่านขั้นรอชำระมาแล้ว (hold ที่ทิ้งไว้ไม่นับ)
          count(*) FILTER (
            WHERE b.status = 'CANCELLED' OR (b.status = 'EXPIRED' AND b.payment_due_at IS NOT NULL)
          ) AS cancelled
        FROM bookings b JOIN market_days md ON md.id = b.market_day_id
        WHERE ${dayWhere(marketId, q)}
        GROUP BY 1
      ),
      r AS (
        SELECT b.vendor_id, sum(p.amount) AS revenue
        FROM payments p
        JOIN bookings b ON b.id = p.booking_id
        JOIN market_days md ON md.id = b.market_day_id
        WHERE p.status = 'APPROVED' AND ${dayWhere(marketId, q)}
        GROUP BY 1
      )
      SELECT v.id, v.first_name, v.last_name, v.shop_name, v.phone, v.status, v.noshow_count,
        coalesce(b.bookings, 0)::int AS bookings,
        coalesce(b.cancelled, 0)::int AS cancelled,
        coalesce(r.revenue, 0) AS revenue
      FROM vendors v
      LEFT JOIN b ON b.vendor_id = v.id
      LEFT JOIN r ON r.vendor_id = v.id
      WHERE v.market_id = ${marketId}::uuid AND (b.vendor_id IS NOT NULL OR v.noshow_count > 0)
      ORDER BY ${order}, v.id
      LIMIT ${q.limit}`;

    const rows: VendorReportRow[] = raw.map((r) => ({
      vendorId: r.id,
      name: `${r.first_name} ${r.last_name}`,
      shopName: r.shop_name,
      phone: canViewPhone ? r.phone : maskPhone(r.phone),
      status: r.status,
      bookings: r.bookings,
      cancelled: r.cancelled,
      revenue: toNumber(r.revenue),
      noshowCount: r.noshow_count,
    }));
    return { from: q.from, to: q.to, sort: q.sort, phoneMasked: !canViewPhone, rows };
  }

  // ───────────── Dashboard ─────────────

  async dashboard(marketId: string, now: Date = new Date()): Promise<Dashboard> {
    const [pendingVendors, pendingPayments, round] = await Promise.all([
      this.prisma.vendor.count({ where: { marketId, status: 'PENDING' } }),
      this.prisma.payment.count({ where: { status: 'PENDING', booking: { marketId } } }),
      this.currentRound(marketId, now),
    ]);
    return { pendingVendors, pendingPayments, round };
  }

  /** รอบที่ยังไม่ปิด (เปิดอยู่/ใกล้เปิดที่สุด) ไม่มีก็รอบล่าสุดที่ปิดแล้ว */
  private async currentRound(marketId: string, now: Date): Promise<DashboardRound | null> {
    const select = { id: true, name: true, status: true, openAt: true, closeAt: true } as const;
    const round =
      (await this.prisma.bookingRound.findFirst({
        where: { marketId, status: 'PUBLISHED', closeAt: { gt: now } },
        orderBy: { openAt: 'asc' },
        select,
      })) ??
      (await this.prisma.bookingRound.findFirst({
        where: { marketId, status: 'PUBLISHED' },
        orderBy: { closeAt: 'desc' },
        select,
      }));
    if (!round) return null;

    const filter = { roundId: round.id };
    const [[occ], [money], marketDays] = await Promise.all([
      this.occupancyRaw(marketId, filter, 'all'),
      this.prisma.$queryRaw<{ revenue: unknown; pending: unknown }[]>`
        SELECT
          (SELECT sum(p.amount) FROM payments p
            JOIN bookings b ON b.id = p.booking_id
            JOIN market_days md ON md.id = b.market_day_id
            WHERE p.status = 'APPROVED' AND ${dayWhere(marketId, filter)}) AS revenue,
          (SELECT sum(b.amount) FROM bookings b
            JOIN market_days md ON md.id = b.market_day_id
            WHERE b.status IN ('PENDING_PAYMENT', 'PENDING_VERIFY')
              AND ${dayWhere(marketId, filter)}) AS pending`,
      this.prisma.marketDay.count({ where: { roundId: round.id, isCancelled: false } }),
    ]);
    const capacity = occ?.capacity ?? 0;
    const confirmed = occ?.confirmed ?? 0;
    return {
      id: round.id,
      name: round.name,
      phase: roundPhase(round, now),
      openAt: round.openAt.toISOString(),
      closeAt: round.closeAt.toISOString(),
      marketDays,
      capacity,
      confirmed,
      pending: occ?.pending ?? 0,
      occupancyRate: rate(confirmed, capacity),
      revenue: toNumber(money?.revenue),
      revenuePending: toNumber(money?.pending),
    };
  }

  // ───────────── ชื่อแถว ─────────────

  /** ชื่อแสดงของ key + ลำดับ (วันที่เรียงตามวัน, รอบตามเวลาเปิด, โซนตาม sort_order) */
  private async labels(
    groupBy: 'day' | 'round' | 'zone',
    keys: string[],
  ): Promise<Map<string, { label: string; order: string | number }>> {
    if (groupBy === 'day') {
      return new Map(keys.map((k) => [k, { label: formatIsoDateTh(k, true), order: k }]));
    }
    if (keys.length === 0) return new Map();
    if (groupBy === 'round') {
      const rounds = await this.prisma.bookingRound.findMany({
        where: { id: { in: keys } },
        select: { id: true, name: true, openAt: true },
      });
      return new Map(rounds.map((r) => [r.id, { label: r.name, order: r.openAt.toISOString() }]));
    }
    const zones = await this.prisma.zone.findMany({
      where: { id: { in: keys } },
      select: { id: true, name: true, sortOrder: true },
    });
    return new Map(zones.map((z) => [z.id, { label: z.name, order: z.sortOrder }]));
  }

  private order(labels: Map<string, { order: string | number }>, a: string, b: string): number {
    const x = labels.get(a)?.order ?? a;
    const y = labels.get(b)?.order ?? b;
    return x < y ? -1 : x > y ? 1 : 0;
  }
}
