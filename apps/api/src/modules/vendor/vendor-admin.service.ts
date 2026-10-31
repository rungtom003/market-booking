import { Injectable } from '@nestjs/common';
import {
  AdminVendorDetail,
  AdminVendorListItem,
  AdminVendorListQuery,
  BulkApproveResult,
  BulkApproveVendorsInput,
  ErrorCode,
  SuspendVendorInput,
  VendorStatusCounts,
} from '@market-booking/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { PaginatedResult, toSkipTake } from '../../common/pagination/paginated-result';
import { PrismaService } from '../../prisma/prisma.service';
import type { AdminPrincipal } from '../auth/principal';
import { MarketService } from '../market/market.service';
import { VendorImageService } from './vendor-image.service';
import { VENDOR_PROFILE_SELECT, toVendorProfile } from './vendor-profile';
import { VendorStatusService } from './vendor-status.service';

/** อนุมัติทั้งหมดที่ค้างได้ครั้งละไม่เกินนี้ (กดซ้ำได้ถ้ามีมากกว่า) */
const BULK_APPROVE_LIMIT = 500;

/** Admin ตรวจ/อนุมัติ/ปฏิเสธ/ระงับผู้ค้า (§9.2) */
@Injectable()
export class VendorAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly markets: MarketService,
    private readonly images: VendorImageService,
    private readonly status: VendorStatusService,
  ) {}

  async list(
    admin: AdminPrincipal,
    query: AdminVendorListQuery,
  ): Promise<PaginatedResult<AdminVendorListItem>> {
    const marketId = await this.markets.resolveForAdmin(admin);
    await this.status.liftExpiredSuspensionsInMarket(marketId);

    const where: Prisma.VendorWhereInput = {
      marketId,
      status: query.status,
      ...(query.q && {
        OR: [
          { firstName: { contains: query.q, mode: 'insensitive' } },
          { lastName: { contains: query.q, mode: 'insensitive' } },
          { shopName: { contains: query.q, mode: 'insensitive' } },
          { phone: { contains: query.q.replace(/[\s-]/g, '') } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.vendor.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          shopName: true,
          phone: true,
          status: true,
          createdAt: true,
          reviewedAt: true,
          productCategory: { select: { name: true } },
        },
        // หน้า "รออนุมัติ" เรียงตามเวลาสมัคร เก่าสุดก่อน (§9.2 ข้อ 1); อย่างอื่นใหม่สุดก่อน
        orderBy: { createdAt: query.status === 'PENDING' ? 'asc' : 'desc' },
        ...toSkipTake(query),
      }),
      this.prisma.vendor.count({ where }),
    ]);

    return PaginatedResult.of(
      rows.map((r) => ({
        id: r.id,
        firstName: r.firstName,
        lastName: r.lastName,
        shopName: r.shopName,
        phone: r.phone,
        status: r.status,
        productCategoryName: r.productCategory?.name ?? null,
        createdAt: r.createdAt.toISOString(),
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
      })),
      total,
      query,
    );
  }

  /** จำนวนต่อสถานะ — badge "รออนุมัติ" ในหน้า admin */
  async counts(admin: AdminPrincipal): Promise<VendorStatusCounts> {
    const marketId = await this.markets.resolveForAdmin(admin);
    await this.status.liftExpiredSuspensionsInMarket(marketId);
    const groups = await this.prisma.vendor.groupBy({
      by: ['status'],
      where: { marketId },
      _count: { _all: true },
    });
    const counts: VendorStatusCounts = { PENDING: 0, APPROVED: 0, REJECTED: 0, SUSPENDED: 0 };
    for (const g of groups) counts[g.status] = g._count._all;
    return counts;
  }

  async detail(admin: AdminPrincipal, vendorId: string): Promise<AdminVendorDetail> {
    await this.assertInScope(admin, vendorId);
    await this.status.liftExpiredSuspension(vendorId);
    const row = await this.prisma.vendor.findUniqueOrThrow({
      where: { id: vendorId },
      select: {
        ...VENDOR_PROFILE_SELECT,
        reviewedBy: { select: { id: true, displayName: true } },
        reviewedAt: true,
        noshowCount: true,
        pdpaConsentAt: true,
      },
    });
    return {
      ...(await toVendorProfile(row, this.images)),
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      noshowCount: row.noshowCount,
      pdpaConsentAt: row.pdpaConsentAt.toISOString(),
    };
  }

  async approve(admin: AdminPrincipal, vendorId: string): Promise<AdminVendorDetail> {
    await this.assertInScope(admin, vendorId);
    await this.status.transition(vendorId, 'approve', {
      actorType: 'ADMIN',
      actorId: admin.id,
      data: { reviewedById: admin.id, reviewedAt: new Date(), rejectReason: null },
    });
    return this.detail(admin, vendorId);
  }

  async reject(
    admin: AdminPrincipal,
    vendorId: string,
    reason: string,
  ): Promise<AdminVendorDetail> {
    await this.assertInScope(admin, vendorId);
    await this.status.transition(vendorId, 'reject', {
      actorType: 'ADMIN',
      actorId: admin.id,
      reason,
      data: { reviewedById: admin.id, reviewedAt: new Date(), rejectReason: reason },
    });
    return this.detail(admin, vendorId);
  }

  async suspend(
    admin: AdminPrincipal,
    vendorId: string,
    input: SuspendVendorInput,
  ): Promise<AdminVendorDetail> {
    const until = new Date(input.until);
    if (until <= new Date()) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Request validation failed', [
        { path: 'until', message: 'ต้องเป็นเวลาในอนาคต', code: 'custom' },
      ]);
    }
    await this.assertInScope(admin, vendorId);
    await this.status.transition(vendorId, 'suspend', {
      actorType: 'ADMIN',
      actorId: admin.id,
      reason: input.reason,
      data: { suspendedUntil: until },
    });
    return this.detail(admin, vendorId);
  }

  async unsuspend(admin: AdminPrincipal, vendorId: string): Promise<AdminVendorDetail> {
    await this.assertInScope(admin, vendorId);
    await this.status.transition(vendorId, 'unsuspend', {
      actorType: 'ADMIN',
      actorId: admin.id,
      data: { suspendedUntil: null },
    });
    return this.detail(admin, vendorId);
  }

  /**
   * อนุมัติหลายรายการ — ทีละรายการ (แต่ละรายการมี audit/แจ้งเตือนของตัวเอง)
   * รายการที่ไม่ใช่ PENDING แล้ว (เช่น admin อีกคนเพิ่งกด) ถูกข้าม ไม่ทำให้ทั้งชุดล้ม
   */
  async bulkApprove(
    admin: AdminPrincipal,
    input: BulkApproveVendorsInput,
  ): Promise<BulkApproveResult> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const ids = input.ids
      ? [...new Set(input.ids)]
      : (
          await this.prisma.vendor.findMany({
            where: { marketId, status: 'PENDING' },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
            take: BULK_APPROVE_LIMIT,
          })
        ).map((v) => v.id);

    const result: BulkApproveResult = { approved: [], skipped: [] };
    for (const id of ids) {
      try {
        await this.assertInScope(admin, id);
        await this.status.transition(id, 'approve', {
          actorType: 'ADMIN',
          actorId: admin.id,
          data: { reviewedById: admin.id, reviewedAt: new Date(), rejectReason: null },
        });
        result.approved.push(id);
      } catch (error) {
        if (!(error instanceof AppException)) throw error;
        if (error.code === ErrorCode.NOT_FOUND) result.skipped.push({ id, reason: 'NOT_FOUND' });
        else if (error.code === ErrorCode.INVALID_STATE_TRANSITION) {
          result.skipped.push({ id, reason: 'NOT_PENDING' });
        } else throw error;
      }
    }
    return result;
  }

  /** admin ที่ผูกตลาดเห็นเฉพาะผู้ค้าในตลาดตัวเอง (ตลาดอื่น = ไม่พบ ไม่บอกว่ามีอยู่) */
  private async assertInScope(admin: AdminPrincipal, vendorId: string): Promise<void> {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { marketId: true },
    });
    if (!vendor || (admin.marketId !== null && vendor.marketId !== admin.marketId)) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Vendor not found');
    }
  }
}
