import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  ACTIVE_BOOKING_STATUSES,
  type ActorType,
  type DeleteMyAccountInput,
  ERASED_VENDOR_NAME,
  ErrorCode,
  type EraseVendorInput,
  type VendorDataExport,
} from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { zonedDate } from '../../common/zoned-date';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AdminPrincipal, VendorPrincipal } from '../auth/principal';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { MarketService } from '../market/market.service';
import { fromIsoDate, toIsoDate } from '../round/round-rules';
import { StorageService } from '../storage/storage.service';

const digits = (s: string) => s.replace(/\D/g, '');
const iso = (d: Date | null) => d?.toISOString() ?? null;

interface EraseActor {
  actorType: ActorType;
  actorId: string | null;
  reason?: string;
}

/**
 * สิทธิ์ของเจ้าของข้อมูล (PDPA, Phase 11.3) — ขอสำเนาข้อมูล และลบข้อมูลส่วนบุคคล
 * การลบ = ทำให้ระบุตัวไม่ได้ (ชื่อ/เบอร์/ที่อยู่เป็นค่าแทน, ลบรูปบัตร/ร้าน/สลิป, ตัด LINE, ลบผู้รับในประวัติแจ้งเตือน)
 * แต่เก็บแถวการจอง/การชำระ (ยอด วันที่ ล็อค) ไว้เป็นบัญชีของตลาด — ย้อนกลับไม่ได้
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly sessions: RefreshTokenService,
    private readonly markets: MarketService,
  ) {}

  async export(vendor: VendorPrincipal, now = new Date()): Promise<VendorDataExport> {
    const v = await this.prisma.vendor.findUnique({
      where: { id: vendor.id },
      include: {
        productCategory: { select: { name: true } },
        bookings: {
          orderBy: { createdAt: 'desc' },
          include: {
            stall: { select: { code: true, zone: { select: { name: true } } } },
            marketDay: { select: { marketDate: true } },
            payments: { orderBy: { createdAt: 'asc' } },
          },
        },
        waitlists: {
          orderBy: { createdAt: 'desc' },
          include: {
            marketDay: { select: { marketDate: true } },
            stall: { select: { code: true } },
            zone: { select: { name: true } },
          },
        },
        notifications: {
          orderBy: { createdAt: 'desc' },
          select: { channel: true, template: true, status: true, createdAt: true },
        },
      },
    });
    if (!v || v.deletedAt) throw new AppException(ErrorCode.NOT_FOUND, 'Vendor not found');
    const url = (key: string | null) => (key ? this.storage.createDownloadUrl(key) : null);

    const result: VendorDataExport = {
      exportedAt: now.toISOString(),
      profile: {
        id: v.id,
        firstName: v.firstName,
        lastName: v.lastName,
        phone: v.phone,
        phoneVerifiedAt: iso(v.phoneVerifiedAt),
        lineLinked: v.lineUserId !== null,
        address: v.address,
        shopName: v.shopName,
        productCategory: v.productCategory?.name ?? null,
        status: v.status,
        rejectReason: v.rejectReason,
        suspendedUntil: iso(v.suspendedUntil),
        noshowCount: v.noshowCount,
        pdpaConsentAt: v.pdpaConsentAt.toISOString(),
        createdAt: v.createdAt.toISOString(),
      },
      images: { idCard: await url(v.idCardImageKey), shop: await url(v.shopImageKey) },
      bookings: await Promise.all(
        v.bookings.map(async (b) => ({
          id: b.id,
          marketDate: toIsoDate(b.marketDay.marketDate),
          stallCode: b.stall.code,
          zoneName: b.stall.zone.name,
          status: b.status,
          amount: Number(b.amount),
          createdAt: b.createdAt.toISOString(),
          confirmedAt: iso(b.confirmedAt),
          cancelledAt: iso(b.cancelledAt),
          cancelReason: b.cancelReason,
          checkedInAt: iso(b.checkedInAt),
          noshow: b.noshowAt !== null,
          payments: await Promise.all(
            b.payments.map(async (p) => ({
              method: p.method,
              amount: Number(p.amount),
              status: p.status,
              rejectReason: p.rejectReason,
              createdAt: p.createdAt.toISOString(),
              slipUrl: await url(p.slipImageKey),
            })),
          ),
        })),
      ),
      waitlists: v.waitlists.map((w) => ({
        marketDate: toIsoDate(w.marketDay.marketDate),
        target: w.stall ? `ล็อค ${w.stall.code}` : `ทั้งโซน ${w.zone?.name ?? '-'}`,
        status: w.status,
        createdAt: w.createdAt.toISOString(),
      })),
      notifications: v.notifications.map((n) => ({
        channel: n.channel,
        template: n.template,
        status: n.status,
        createdAt: n.createdAt.toISOString(),
      })),
    };
    await this.audit.log({
      actorType: 'VENDOR',
      actorId: vendor.id,
      action: 'vendor.data_export',
      entity: { type: 'vendor', id: vendor.id },
    });
    return result;
  }

  /** ผู้ค้าลบบัญชีตัวเอง — ยืนยันด้วยเบอร์โทรของบัญชี */
  async eraseSelf(vendor: VendorPrincipal, input: DeleteMyAccountInput): Promise<void> {
    const row = await this.prisma.vendor.findUnique({
      where: { id: vendor.id },
      select: { phone: true },
    });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Vendor not found');
    if (digits(input.confirmPhone) !== digits(row.phone)) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Request validation failed', [
        { path: 'confirmPhone', message: 'เบอร์โทรไม่ตรงกับบัญชีนี้', code: 'custom' },
      ]);
    }
    await this.erase(vendor.id, { actorType: 'VENDOR', actorId: vendor.id });
  }

  /** เจ้าหน้าที่ลบตามคำขอ (สิทธิ์ `VENDOR_DATA_ERASE`) */
  async eraseByAdmin(admin: AdminPrincipal, vendorId: string, input: EraseVendorInput) {
    const marketId = await this.markets.resolveForAdmin(admin);
    const found = await this.prisma.vendor.findFirst({
      where: { id: vendorId, marketId },
      select: { id: true },
    });
    if (!found) throw new AppException(ErrorCode.NOT_FOUND, 'Vendor not found');
    await this.erase(vendorId, { actorType: 'ADMIN', actorId: admin.id, reason: input.reason });
  }

  /**
   * ลบข้อมูลส่วนบุคคล — ยังมีการจองที่ยังไม่ถึงวันขาย (รวมวันนี้) → `ACCOUNT_HAS_ACTIVE_BOOKINGS`
   * ลบแล้วเรียกซ้ำได้ (ไม่ทำอะไร)
   */
  async erase(vendorId: string, actor: EraseActor, now = new Date()): Promise<void> {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: {
        deletedAt: true,
        marketId: true,
        idCardImageKey: true,
        shopImageKey: true,
        status: true,
        market: { select: { timezone: true } },
      },
    });
    if (!vendor) throw new AppException(ErrorCode.NOT_FOUND, 'Vendor not found');
    if (vendor.deletedAt) return;

    const today = fromIsoDate(zonedDate(now, vendor.market.timezone));
    const active = await this.prisma.booking.count({
      where: {
        vendorId,
        status: { in: [...ACTIVE_BOOKING_STATUSES] },
        marketDay: { marketDate: { gte: today }, isCancelled: false },
      },
    });
    if (active > 0) {
      throw new AppException(ErrorCode.ACCOUNT_HAS_ACTIVE_BOOKINGS, 'Vendor has active bookings', {
        count: active,
      });
    }

    const slips = await this.prisma.payment.findMany({
      where: { booking: { vendorId }, slipImageKey: { not: null } },
      select: { slipImageKey: true },
    });
    const keys = [
      vendor.idCardImageKey,
      vendor.shopImageKey,
      ...slips.map((p) => p.slipImageKey),
    ].filter((k): k is string => Boolean(k));

    await this.prisma.$transaction(async (tx) => {
      await tx.vendor.update({
        where: { id: vendorId },
        data: {
          firstName: ERASED_VENDOR_NAME,
          lastName: '',
          // unique ต่อตลาด — เบอร์เดิมสมัครใหม่ได้
          phone: `del-${randomBytes(8).toString('hex')}`,
          phoneVerifiedAt: null,
          lineUserId: null,
          address: '-',
          shopName: null,
          idCardImageKey: null,
          shopImageKey: null,
          rejectReason: null,
          deletedAt: now,
        },
      });
      await tx.waitlist.updateMany({
        where: { vendorId, status: { in: ['WAITING', 'NOTIFIED'] } },
        data: { status: 'CANCELLED' },
      });
      await tx.payment.updateMany({
        where: { booking: { vendorId }, slipImageKey: { not: null } },
        data: { slipImageKey: null },
      });
      await tx.notificationLog.updateMany({
        where: { vendorId },
        data: { recipient: '-', payload: {} },
      });
      await this.audit.log(
        {
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'vendor.erase',
          entity: { type: 'vendor', id: vendorId },
          before: { status: vendor.status },
          after: { deletedFiles: keys.length, ...(actor.reason && { reason: actor.reason }) },
        },
        tx,
      );
    });

    await this.sessions.revokeAll({ type: 'VENDOR', id: vendorId });
    for (const key of keys) {
      await this.storage
        .delete(key)
        .catch((e: unknown) => this.logger.warn(`Delete ${key} failed: ${String(e)}`));
    }
  }
}
