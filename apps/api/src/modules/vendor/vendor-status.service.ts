import { Injectable } from '@nestjs/common';
import { ActorType, ErrorCode, VendorStatus } from '@market-booking/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotifyService } from '../notify/notify.service';

/** การเปลี่ยนสถานะที่อนุญาต (Overview §8.1) — นอกเหนือจากนี้ = INVALID_STATE_TRANSITION */
export const VENDOR_TRANSITIONS = {
  approve: { from: ['PENDING'], to: 'APPROVED' },
  reject: { from: ['PENDING'], to: 'REJECTED' },
  /** ผู้ค้าที่ถูกปฏิเสธแก้ข้อมูลแล้วส่งใหม่ */
  resubmit: { from: ['REJECTED'], to: 'PENDING' },
  suspend: { from: ['APPROVED'], to: 'SUSPENDED' },
  unsuspend: { from: ['SUSPENDED'], to: 'APPROVED' },
} as const satisfies Record<string, { from: readonly VendorStatus[]; to: VendorStatus }>;

export type VendorTransition = keyof typeof VENDOR_TRANSITIONS;

export interface TransitionContext {
  actorType: ActorType;
  actorId: string | null;
  /** เหตุผล (ปฏิเสธ/ระงับ) — ลง audit และแจ้งผู้ค้า */
  reason?: string | null;
  /** ข้อมูลอื่นที่แก้พร้อมกันใน transaction เดียว (เช่น reviewed_by, suspended_until) */
  data?: Prisma.VendorUncheckedUpdateManyInput;
}

const STATUS_FIELDS = {
  id: true,
  marketId: true,
  status: true,
  rejectReason: true,
  suspendedUntil: true,
  reviewedById: true,
  reviewedAt: true,
} satisfies Prisma.VendorSelect;

type StatusRow = Prisma.VendorGetPayload<{ select: typeof STATUS_FIELDS }>;

@Injectable()
export class VendorStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  /**
   * เปลี่ยนสถานะแบบ atomic: `UPDATE … WHERE id = ? AND status IN (from)` แล้วตรวจจำนวนแถว
   * — admin สองคนกดพร้อมกันได้ผลแค่ครั้งเดียว อีกคนได้ INVALID_STATE_TRANSITION
   */
  async transition(
    vendorId: string,
    name: VendorTransition,
    ctx: TransitionContext,
  ): Promise<StatusRow> {
    const { from, to } = VENDOR_TRANSITIONS[name];

    const { before, after } = await this.prisma.$transaction(async (tx) => {
      const before = await tx.vendor.findUnique({ where: { id: vendorId }, select: STATUS_FIELDS });
      if (!before) throw new AppException(ErrorCode.NOT_FOUND, 'Vendor not found');

      const { count } = await tx.vendor.updateMany({
        where: { id: vendorId, status: { in: [...from] } },
        data: { ...ctx.data, status: to },
      });
      if (count === 0) {
        throw new AppException(
          ErrorCode.INVALID_STATE_TRANSITION,
          `Cannot ${name} a vendor that is ${before.status}`,
          { from: before.status, action: name },
        );
      }

      const after = await tx.vendor.findUniqueOrThrow({
        where: { id: vendorId },
        select: STATUS_FIELDS,
      });
      await this.audit.log(
        {
          actorType: ctx.actorType,
          actorId: ctx.actorId,
          action: `vendor.${name}`,
          entity: { type: 'vendor', id: vendorId },
          before: auditView(before),
          after: { ...auditView(after), ...(ctx.reason && { reason: ctx.reason }) },
        },
        tx,
      );
      return { before, after };
    });

    // หลัง commit — ถ้าแจ้งเตือนล้ม สถานะยังเปลี่ยนแล้ว (NotifyService ไม่ throw)
    await this.notify.vendorStatusChanged({
      vendorId,
      marketId: after.marketId,
      from: before.status,
      to: after.status,
      reason: ctx.reason,
      suspendedUntil: after.suspendedUntil,
    });
    return after;
  }

  /**
   * การระงับที่หมดเวลาแล้วกลับเป็น APPROVED (§8.1 "หมดเวลาระงับ") — เรียกตอนอ่านสถานะ
   * (guard, หน้าโปรไฟล์, รายการของ admin) แทนการมี cron
   */
  async liftExpiredSuspension(vendorId: string): Promise<void> {
    const now = new Date();
    const { count } = await this.prisma.vendor.updateMany({
      where: { id: vendorId, status: 'SUSPENDED', suspendedUntil: { lte: now } },
      data: { status: 'APPROVED', suspendedUntil: null },
    });
    if (count === 0) return;

    const vendor = await this.prisma.vendor.findUniqueOrThrow({
      where: { id: vendorId },
      select: { marketId: true },
    });
    await this.audit.log({
      actorType: 'SYSTEM',
      action: 'vendor.suspension_expired',
      entity: { type: 'vendor', id: vendorId },
      before: { status: 'SUSPENDED' },
      after: { status: 'APPROVED' },
    });
    await this.notify.vendorStatusChanged({
      vendorId,
      marketId: vendor.marketId,
      from: 'SUSPENDED',
      to: 'APPROVED',
    });
  }

  async liftExpiredSuspensionsInMarket(marketId: string): Promise<void> {
    const expired = await this.prisma.vendor.findMany({
      where: { marketId, status: 'SUSPENDED', suspendedUntil: { lte: new Date() } },
      select: { id: true },
    });
    for (const { id } of expired) await this.liftExpiredSuspension(id);
  }
}

function auditView(row: StatusRow) {
  return {
    status: row.status,
    rejectReason: row.rejectReason,
    suspendedUntil: row.suspendedUntil,
  };
}
