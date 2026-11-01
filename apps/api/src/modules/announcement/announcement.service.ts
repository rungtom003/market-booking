import { Injectable } from '@nestjs/common';
import {
  type AdminAnnouncement,
  type Announcement,
  type CreateAnnouncementInput,
  ErrorCode,
  type UpdateAnnouncementInput,
  announcementState,
} from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AdminPrincipal } from '../auth/principal';
import { MarketService } from '../market/market.service';

/** ผู้ค้าเห็นได้ไม่เกินนี้ (ประกาศเก่าที่ไม่หมดอายุควรตั้ง expireAt) */
const VENDOR_LIMIT = 20;

type Row = Prisma.AnnouncementGetPayload<object>;

function toAnnouncement(row: Row): Announcement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    publishAt: row.publishAt.toISOString(),
    expireAt: row.expireAt?.toISOString() ?? null,
    isPinned: row.isPinned,
  };
}

function toAdmin(row: Row, now: Date): AdminAnnouncement {
  return {
    ...toAnnouncement(row),
    state: announcementState(row, now),
    broadcastLine: row.broadcastLine,
    broadcastedAt: row.broadcastedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** ประกาศของตลาด (Overview §11, Phase 9.3) — ส่ง LINE ทำใน NotificationReminders (tick ทุกนาที) */
@Injectable()
export class AnnouncementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly markets: MarketService,
    private readonly audit: AuditService,
  ) {}

  /** ที่กำลังแสดง: ปักหมุดก่อน แล้วเผยแพร่ล่าสุดก่อน */
  async active(marketId: string, now: Date = new Date()): Promise<Announcement[]> {
    const rows = await this.prisma.announcement.findMany({
      where: {
        marketId,
        publishAt: { lte: now },
        OR: [{ expireAt: null }, { expireAt: { gt: now } }],
      },
      orderBy: [{ isPinned: 'desc' }, { publishAt: 'desc' }],
      take: VENDOR_LIMIT,
    });
    return rows.map(toAnnouncement);
  }

  async list(admin: AdminPrincipal, now: Date = new Date()): Promise<AdminAnnouncement[]> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const rows = await this.prisma.announcement.findMany({
      where: { marketId },
      orderBy: [{ publishAt: 'desc' }],
    });
    return rows.map((r) => toAdmin(r, now));
  }

  async create(admin: AdminPrincipal, input: CreateAnnouncementInput): Promise<AdminAnnouncement> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.announcement.create({
        data: {
          marketId,
          title: input.title,
          body: input.body,
          publishAt: new Date(input.publishAt),
          expireAt: input.expireAt ? new Date(input.expireAt) : null,
          isPinned: input.isPinned,
          broadcastLine: input.broadcastLine,
        },
      });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'announcement.create',
          entity: { type: 'announcement', id: created.id },
          after: { title: created.title, broadcastLine: created.broadcastLine },
        },
        tx,
      );
      return created;
    });
    return toAdmin(row, new Date());
  }

  async update(
    admin: AdminPrincipal,
    id: string,
    input: UpdateAnnouncementInput,
  ): Promise<AdminAnnouncement> {
    const before = await this.findInScope(admin, id);
    // แก้ช่วงเวลาบางส่วน: ตรวจคู่ publish/expire กับค่าที่มีอยู่ด้วย
    const publishAt = input.publishAt ? new Date(input.publishAt) : before.publishAt;
    const expireAt =
      input.expireAt === undefined
        ? before.expireAt
        : input.expireAt
          ? new Date(input.expireAt)
          : null;
    if (expireAt && expireAt <= publishAt) {
      // รูปแบบเดียวกับ ZodValidationPipe ให้หน้าเว็บแสดงใต้ช่องได้
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'expireAt must be after publishAt', [
        { path: 'expireAt', message: 'เวลาสิ้นสุดต้องหลังเวลาเผยแพร่', code: 'custom' },
      ]);
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.announcement.update({
        where: { id },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.body !== undefined && { body: input.body }),
          publishAt,
          expireAt,
          ...(input.isPinned !== undefined && { isPinned: input.isPinned }),
          ...(input.broadcastLine !== undefined && { broadcastLine: input.broadcastLine }),
        },
      });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'announcement.update',
          entity: { type: 'announcement', id },
          before: { title: before.title, publishAt: before.publishAt, expireAt: before.expireAt },
          after: input,
        },
        tx,
      );
      return updated;
    });
    return toAdmin(row, new Date());
  }

  async remove(admin: AdminPrincipal, id: string): Promise<void> {
    const before = await this.findInScope(admin, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.announcement.delete({ where: { id } });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'announcement.delete',
          entity: { type: 'announcement', id },
          before: { title: before.title },
        },
        tx,
      );
    });
  }

  private async findInScope(admin: AdminPrincipal, id: string): Promise<Row> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const row = await this.prisma.announcement.findFirst({ where: { id, marketId } });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Announcement not found');
    return row;
  }
}
