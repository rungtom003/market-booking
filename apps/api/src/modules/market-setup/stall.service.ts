import { Injectable } from '@nestjs/common';
import {
  AdminStallListQuery,
  BulkCreateStallsInput,
  BulkCreateStallsResult,
  CreateStallInput,
  ErrorCode,
  Stall,
  UpdateStallInput,
  bulkStallCodes,
} from '@market-booking/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AdminPrincipal } from '../auth/principal';
import { MarketService } from '../market/market.service';
import { compareStalls, toMapStall } from './stall-mapper';
import { ZoneService } from './zone.service';

const FIELDS = {
  id: true,
  zoneId: true,
  code: true,
  widthM: true,
  lengthM: true,
  price: true,
  posX: true,
  posY: true,
  rot: true,
  shapeW: true,
  shapeH: true,
  isActive: true,
  isReserved: true,
  note: true,
  zone: { select: { sortOrder: true } },
  _count: { select: { bookings: true } },
} satisfies Prisma.StallSelect;

type StallRow = Prisma.StallGetPayload<{ select: typeof FIELDS }>;

function toDto(row: StallRow): Stall {
  return {
    ...toMapStall(row),
    isActive: row.isActive,
    isReserved: row.isReserved,
    note: row.note,
    hasBookings: row._count.bookings > 0,
  };
}

/** ค่าที่เก็บใน audit (ไม่มี relation/count) */
function snapshot(row: StallRow) {
  const { hasBookings: _h, ...rest } = toDto(row);
  return rest;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** ระยะห่างจากล็อคล่างสุดเมื่อ bulk create ไม่ระบุ `originY` */
const DEFAULT_ROW_GAP = 40;

@Injectable()
export class StallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly markets: MarketService,
    private readonly zones: ZoneService,
  ) {}

  /** ทุกล็อคของตลาด (ไม่แบ่งหน้า — ใช้วาดผังด้วย) เรียงตามโซนแล้วรหัสแบบตัวเลข (A2 ก่อน A10) */
  async list(admin: AdminPrincipal, query: AdminStallListQuery): Promise<Stall[]> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const rows = await this.prisma.stall.findMany({
      where: { marketId, zoneId: query.zoneId, isActive: query.isActive },
      select: FIELDS,
    });
    return rows
      .sort((a, b) => a.zone.sortOrder - b.zone.sortOrder || compareStalls(a, b))
      .map(toDto);
  }

  async create(admin: AdminPrincipal, input: CreateStallInput): Promise<Stall> {
    const zone = await this.zones.findInScope(admin, input.zoneId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.stall.create({
          data: { ...input, marketId: zone.marketId },
          select: FIELDS,
        });
        await this.audit.log(
          {
            actorType: 'ADMIN',
            actorId: admin.id,
            action: 'stall.create',
            entity: { type: 'stall', id: row.id },
            after: snapshot(row),
          },
          tx,
        );
        return toDto(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw this.codeTaken([input.code]);
      throw error;
    }
  }

  /** prefix + ช่วงเลข เช่น A1–A20 วางเป็นตารางบนผัง — รหัสซ้ำแม้ตัวเดียวจะไม่สร้างเลยสักล็อค */
  async bulkCreate(
    admin: AdminPrincipal,
    input: BulkCreateStallsInput,
  ): Promise<BulkCreateStallsResult> {
    const zone = await this.zones.findInScope(admin, input.zoneId);
    const marketId = zone.marketId;
    const codes = bulkStallCodes(input);

    const taken = await this.prisma.stall.findMany({
      where: { marketId, code: { in: codes } },
      select: { code: true },
    });
    if (taken.length > 0) throw this.codeTaken(taken.map((t) => t.code));

    const originY = input.originY ?? (await this.nextFreeRowY(marketId));
    const data = codes.map((code, i) => ({
      marketId,
      zoneId: zone.id,
      code,
      widthM: input.widthM,
      lengthM: input.lengthM,
      price: input.price,
      shapeW: input.shapeW,
      shapeH: input.shapeH,
      posX: input.originX + (i % input.columns) * (input.shapeW + input.gap),
      posY: originY + Math.floor(i / input.columns) * (input.shapeH + input.gap),
    }));

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.stall.createMany({ data });
        await this.audit.log(
          {
            actorType: 'ADMIN',
            actorId: admin.id,
            action: 'stall.bulk_create',
            entity: { type: 'zone', id: zone.id },
            after: { ...input, originY, codes },
          },
          tx,
        );
      });
    } catch (error) {
      // มีคนสร้างรหัสเดียวกันตัดหน้าระหว่างตรวจกับบันทึก
      if (isUniqueViolation(error)) throw this.codeTaken(codes);
      throw error;
    }
    return { created: codes.length, codes };
  }

  async update(admin: AdminPrincipal, id: string, input: UpdateStallInput): Promise<Stall> {
    const before = await this.findInScope(admin, id);
    if (input.zoneId && input.zoneId !== before.zoneId) {
      await this.zones.findInScope(admin, input.zoneId);
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.stall.update({ where: { id }, data: input, select: FIELDS });
        await this.audit.log(
          {
            actorType: 'ADMIN',
            actorId: admin.id,
            action: 'stall.update',
            entity: { type: 'stall', id },
            before: snapshot(before),
            after: snapshot(row),
          },
          tx,
        );
        return toDto(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw this.codeTaken([input.code ?? before.code]);
      throw error;
    }
  }

  /** ห้ามลบล็อคที่มีการจอง/รอคิว (ต้องเก็บประวัติ) → ให้ปิดการใช้งานด้วย `isActive: false` แทน */
  async remove(admin: AdminPrincipal, id: string): Promise<void> {
    const before = await this.findInScope(admin, id);
    const waitlists = await this.prisma.waitlist.count({ where: { stallId: id } });
    if (before._count.bookings > 0 || waitlists > 0) {
      throw new AppException(
        ErrorCode.RESOURCE_IN_USE,
        'Stall has bookings — deactivate it (isActive=false) instead',
        { bookings: before._count.bookings, waitlists },
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.stallDayOverride.deleteMany({ where: { stallId: id } });
      await tx.stall.delete({ where: { id } });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'stall.delete',
          entity: { type: 'stall', id },
          before: snapshot(before),
        },
        tx,
      );
    });
  }

  private async findInScope(admin: AdminPrincipal, id: string): Promise<StallRow> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const row = await this.prisma.stall.findFirst({ where: { id, marketId }, select: FIELDS });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Stall not found');
    return row;
  }

  /** ขอบล่างของล็อคที่ต่ำสุดบนผัง + ระยะห่าง (ตลาดว่าง = 20) */
  private async nextFreeRowY(marketId: string): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ bottom: Prisma.Decimal | null }[]>`
      SELECT MAX(pos_y + shape_h) AS bottom FROM stalls WHERE market_id = ${marketId}::uuid`;
    return row?.bottom == null ? 20 : Math.ceil(Number(row.bottom)) + DEFAULT_ROW_GAP;
  }

  private codeTaken(codes: string[]): AppException {
    return new AppException(ErrorCode.STALL_CODE_TAKEN, 'Stall code already exists', { codes });
  }
}
