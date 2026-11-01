import { Injectable } from '@nestjs/common';
import type { ActorType, AuditLogEntry, AuditLogQuery } from '@market-booking/shared';
import { PaginatedResult, toSkipTake } from '../../common/pagination/paginated-result';
import { zonedDayStart } from '../../common/zoned-date';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const DAY_MS = 86_400_000;

/**
 * ค้น audit log (Phase 8) — ตารางไม่มี market_id (MVP ตลาดเดียว) จึงเห็นทุกรายการ
 * เปิดให้เฉพาะ SUPER_ADMIN/ADMIN (`AUDIT_LOG_VIEW`); before/after ถูกตัดข้อมูลลับไว้แล้วตอนบันทึก
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: AuditLogQuery, timeZone: string): Promise<PaginatedResult<AuditLogEntry>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.actorType && { actorType: q.actorType }),
      ...(q.actorId && { actorId: q.actorId }),
      ...(q.entityType && { entityType: q.entityType }),
      ...(q.entityId && { entityId: q.entityId }),
      // ลงท้ายด้วย "." = ทุก action ของ entity นั้น เช่น `vendor.`
      ...(q.action && {
        action: q.action.endsWith('.') ? { startsWith: q.action } : q.action,
      }),
      ...((q.from || q.to) && {
        createdAt: {
          ...(q.from && { gte: zonedDayStart(q.from, timeZone) }),
          ...(q.to && { lt: new Date(zonedDayStart(q.to, timeZone).getTime() + DAY_MS) }),
        },
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const names = await this.actorNames(rows);
    const items = rows.map((r): AuditLogEntry => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      actorType: r.actorType as ActorType,
      actorId: r.actorId,
      actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.before,
      after: r.after,
      ip: r.ip,
      userAgent: r.userAgent,
    }));
    return PaginatedResult.of(items, total, q);
  }

  /** action ทั้งหมดที่เคยเกิด — ตัวเลือกใน filter (ใช้ index ของ action) */
  async actions(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ action: string }[]>`
      SELECT DISTINCT action FROM audit_logs ORDER BY action`;
    return rows.map((r) => r.action);
  }

  private async actorNames(
    rows: readonly { actorType: string; actorId: string | null }[],
  ): Promise<Map<string, string>> {
    const ids = (type: string) => [
      ...new Set(rows.filter((r) => r.actorType === type && r.actorId).map((r) => r.actorId!)),
    ];
    const [admins, vendors] = await Promise.all([
      this.prisma.adminUser.findMany({
        where: { id: { in: ids('ADMIN') } },
        select: { id: true, displayName: true, username: true },
      }),
      this.prisma.vendor.findMany({
        where: { id: { in: ids('VENDOR') } },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);
    return new Map([
      ...admins.map((a): [string, string] => [a.id, `${a.displayName} (${a.username})`]),
      ...vendors.map((v): [string, string] => [v.id, `${v.firstName} ${v.lastName}`]),
    ]);
  }
}
