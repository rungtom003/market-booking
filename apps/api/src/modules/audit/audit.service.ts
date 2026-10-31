import { Injectable } from '@nestjs/common';
import type { ActorType } from '@market-booking/shared';
import { Prisma } from '../../generated/prisma/client';
import { getRequestContext } from '../../common/request-context';
import { redact } from '../../common/redact';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  actorType: ActorType;
  /** null สำหรับ SYSTEM */
  actorId?: string | null;
  /** `<entity>.<verb>` เช่น `vendor.approve`, `booking.cancel`, `settings.update` */
  action: string;
  entity: { type: string; id?: string | null };
  before?: unknown;
  after?: unknown;
}

type AuditDb = Pick<Prisma.TransactionClient, 'auditLog'>;

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const json = redact(value);
  return json === undefined || json === null ? Prisma.DbNull : (json as Prisma.InputJsonValue);
}

/** บันทึก audit log (Overview §5 ข้อ 4: ทุก action ของ Admin ต้องลง Audit Log) */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ส่ง `tx` เมื่อเรียกใน `prisma.$transaction` เพื่อให้ audit log commit/rollback พร้อมกับการเปลี่ยนแปลงจริง
   * ip/user-agent อ่านจาก request ปัจจุบันอัตโนมัติ; ค่า before/after ถูกตัดข้อมูลอ่อนไหว (password, token, …) ออก
   */
  async log(entry: AuditEntry, tx: AuditDb = this.prisma): Promise<void> {
    const ctx = getRequestContext();
    await tx.auditLog.create({
      data: {
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entity.type,
        entityId: entry.entity.id ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
        ip: ctx?.ip?.slice(0, 45) ?? null,
        userAgent: ctx?.userAgent ?? null,
      },
    });
  }
}
