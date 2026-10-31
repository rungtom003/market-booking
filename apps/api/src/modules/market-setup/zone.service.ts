import { Injectable } from '@nestjs/common';
import { CreateZoneInput, ErrorCode, UpdateZoneInput, Zone } from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AdminPrincipal } from '../auth/principal';
import { MarketService } from '../market/market.service';

const FIELDS = {
  id: true,
  name: true,
  color: true,
  allowedCategoryIds: true,
  sortOrder: true,
} as const;

@Injectable()
export class ZoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly markets: MarketService,
  ) {}

  async list(admin: AdminPrincipal): Promise<Zone[]> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const rows = await this.prisma.zone.findMany({
      where: { marketId },
      select: { ...FIELDS, _count: { select: { stalls: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(({ _count, ...r }) => ({ ...r, stallCount: _count.stalls }));
  }

  async create(admin: AdminPrincipal, input: CreateZoneInput): Promise<Zone> {
    const marketId = await this.markets.resolveForAdmin(admin);
    await this.assertCategoriesInMarket(marketId, input.allowedCategoryIds);
    const sortOrder =
      input.sortOrder ??
      ((await this.prisma.zone.aggregate({ where: { marketId }, _max: { sortOrder: true } }))._max
        .sortOrder ?? -1) + 1;

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.zone.create({
        data: { ...input, marketId, sortOrder },
        select: FIELDS,
      });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'zone.create',
          entity: { type: 'zone', id: row.id },
          after: row,
        },
        tx,
      );
      return { ...row, stallCount: 0 };
    });
  }

  async update(admin: AdminPrincipal, id: string, input: UpdateZoneInput): Promise<Zone> {
    const before = await this.findInScope(admin, id);
    if (input.allowedCategoryIds) {
      await this.assertCategoriesInMarket(before.marketId, input.allowedCategoryIds);
    }
    return this.prisma.$transaction(async (tx) => {
      const { _count, ...after } = await tx.zone.update({
        where: { id },
        data: input,
        select: { ...FIELDS, _count: { select: { stalls: true } } },
      });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'zone.update',
          entity: { type: 'zone', id },
          before,
          after,
        },
        tx,
      );
      return { ...after, stallCount: _count.stalls };
    });
  }

  /** ลบได้เมื่อไม่มีล็อคและรายการรอคิวในโซน — ย้าย/ลบล็อคออกก่อน */
  async remove(admin: AdminPrincipal, id: string): Promise<void> {
    const before = await this.findInScope(admin, id);
    const [stalls, waitlists] = await Promise.all([
      this.prisma.stall.count({ where: { zoneId: id } }),
      this.prisma.waitlist.count({ where: { zoneId: id } }),
    ]);
    if (stalls > 0 || waitlists > 0) {
      throw new AppException(ErrorCode.RESOURCE_IN_USE, 'Zone still has stalls or waitlists', {
        stalls,
        waitlists,
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.zone.delete({ where: { id } });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'zone.delete',
          entity: { type: 'zone', id },
          before,
        },
        tx,
      );
    });
  }

  /** โซนต้องอยู่ในตลาดเดียวกับ admin — ใช้ตอนสร้าง/ย้ายล็อคด้วย */
  async findInScope(admin: AdminPrincipal, id: string) {
    const marketId = await this.markets.resolveForAdmin(admin);
    const row = await this.prisma.zone.findFirst({
      where: { id, marketId },
      select: { ...FIELDS, marketId: true },
    });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Zone not found');
    return row;
  }

  /** `allowed_category_ids` เป็น array ไม่มี FK — ตรวจที่นี่ */
  private async assertCategoriesInMarket(marketId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const found = await this.prisma.productCategory.count({ where: { marketId, id: { in: ids } } });
    if (found !== ids.length) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Request validation failed', [
        { path: 'allowedCategoryIds', message: 'มีประเภทสินค้าที่ไม่พบในตลาดนี้', code: 'custom' },
      ]);
    }
  }
}
