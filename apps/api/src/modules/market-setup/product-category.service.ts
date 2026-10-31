import { Injectable } from '@nestjs/common';
import {
  CreateProductCategoryInput,
  ErrorCode,
  ProductCategory,
  UpdateProductCategoryInput,
} from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AdminPrincipal } from '../auth/principal';
import { MarketService } from '../market/market.service';

const FIELDS = { id: true, name: true, sortOrder: true } as const;

/** ประเภทสินค้า — ใช้ในฟอร์มสมัครผู้ค้าและจำกัดโซน (`zones.allowed_category_ids`) */
@Injectable()
export class ProductCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly markets: MarketService,
  ) {}

  async list(admin: AdminPrincipal): Promise<ProductCategory[]> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const rows = await this.prisma.productCategory.findMany({
      where: { marketId },
      select: { ...FIELDS, _count: { select: { vendors: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(({ _count, ...r }) => ({ ...r, vendorCount: _count.vendors }));
  }

  async create(admin: AdminPrincipal, input: CreateProductCategoryInput): Promise<ProductCategory> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const sortOrder =
      input.sortOrder ??
      ((
        await this.prisma.productCategory.aggregate({
          where: { marketId },
          _max: { sortOrder: true },
        })
      )._max.sortOrder ?? -1) + 1;

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.productCategory.create({
        data: { marketId, name: input.name, sortOrder },
        select: FIELDS,
      });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'product_category.create',
          entity: { type: 'product_category', id: row.id },
          after: row,
        },
        tx,
      );
      return { ...row, vendorCount: 0 };
    });
  }

  async update(
    admin: AdminPrincipal,
    id: string,
    input: UpdateProductCategoryInput,
  ): Promise<ProductCategory> {
    const before = await this.findInScope(admin, id);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.productCategory.update({
        where: { id },
        data: input,
        select: { ...FIELDS, _count: { select: { vendors: true } } },
      });
      const { _count, ...after } = row;
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'product_category.update',
          entity: { type: 'product_category', id },
          before,
          after,
        },
        tx,
      );
      return { ...after, vendorCount: _count.vendors };
    });
  }

  /** ลบได้เมื่อไม่มีผู้ค้าเลือกประเภทนี้ — ลบออกจากรายการประเภทที่อนุญาตของทุกโซนด้วย */
  async remove(admin: AdminPrincipal, id: string): Promise<void> {
    const before = await this.findInScope(admin, id);
    const vendors = await this.prisma.vendor.count({ where: { productCategoryId: id } });
    if (vendors > 0) {
      throw new AppException(ErrorCode.RESOURCE_IN_USE, 'Category is used by vendors', {
        vendors,
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE zones SET allowed_category_ids = array_remove(allowed_category_ids, ${id}::uuid)
        WHERE market_id = ${before.marketId}::uuid AND ${id}::uuid = ANY (allowed_category_ids)`;
      await tx.productCategory.delete({ where: { id } });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'product_category.delete',
          entity: { type: 'product_category', id },
          before,
        },
        tx,
      );
    });
  }

  private async findInScope(admin: AdminPrincipal, id: string) {
    const marketId = await this.markets.resolveForAdmin(admin);
    const row = await this.prisma.productCategory.findFirst({
      where: { id, marketId },
      select: { ...FIELDS, marketId: true },
    });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Product category not found');
    return row;
  }
}
