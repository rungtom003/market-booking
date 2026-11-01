import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  type AdminMapLayout,
  ErrorCode,
  type MapBackground,
  type MapBackgroundUploadInput,
  type MapFeature,
  type MapFeatureKind,
  type SaveMapLayoutInput,
  type UploadTicket,
} from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AdminPrincipal } from '../auth/principal';
import { MarketService } from '../market/market.service';
import { IMAGE_EXTENSION, checkUploadedImage } from '../storage/image-file';
import { StorageService } from '../storage/storage.service';
import { compareStalls, toMapStall } from './stall-mapper';

const FEATURE_FIELDS = {
  id: true,
  kind: true,
  label: true,
  posX: true,
  posY: true,
  width: true,
  height: true,
  rot: true,
} as const;

type FeatureRow = Prisma.MapFeatureGetPayload<{ select: typeof FEATURE_FIELDS }>;

function toFeature(row: FeatureRow): MapFeature {
  return {
    id: row.id,
    kind: row.kind as MapFeatureKind,
    label: row.label,
    posX: Number(row.posX),
    posY: Number(row.posY),
    width: Number(row.width),
    height: Number(row.height),
    rot: Number(row.rot),
  };
}

/** ค่าที่ต่างกันน้อยกว่านี้ถือว่าไม่ได้ย้าย (คอลัมน์ทศนิยม 2 ตำแหน่ง) */
const same = (a: Prisma.Decimal | number, b: number) => Math.abs(Number(a) - b) < 0.005;
const round2 = (n: number) => Math.round(n * 100) / 100;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * ผังตลาดแบบเต็ม (Phase 9.1): พื้นหลัง (รูปแปลน) + ทางเดิน/สัญลักษณ์ + บันทึกจาก Map Editor ทั้งชุด
 * ทุกการบันทึกเพิ่ม `markets.layout_version` — ส่ง version เก่ามา = มีคนบันทึกก่อน (LAYOUT_OUTDATED)
 */
@Injectable()
export class MapLayoutService {
  private readonly logger = new Logger(MapLayoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly markets: MarketService,
    private readonly audit: AuditService,
  ) {}

  /** ส่วนที่ผู้ค้าเห็นเพิ่มจากล็อค: พื้นหลัง + สัญลักษณ์ */
  async decorations(
    marketId: string,
  ): Promise<{ background: MapBackground | null; features: MapFeature[] }> {
    const [market, features] = await Promise.all([
      this.prisma.market.findUniqueOrThrow({
        where: { id: marketId },
        select: { mapBackgroundKey: true, mapBackgroundW: true, mapBackgroundH: true },
      }),
      this.features(marketId),
    ]);
    return { background: await this.background(market), features };
  }

  async adminLayout(admin: AdminPrincipal): Promise<AdminMapLayout> {
    return this.load(await this.markets.resolveForAdmin(admin));
  }

  /** URL อัปโหลดรูปแปลน — ใช้ได้เมื่อบันทึกผังพร้อม key นี้ (ตรวจว่าเป็นรูปจริงตอนบันทึก) */
  async backgroundUpload(
    admin: AdminPrincipal,
    input: MapBackgroundUploadInput,
  ): Promise<UploadTicket> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const key = `${this.backgroundPrefix(marketId)}${randomUUID()}.${IMAGE_EXTENSION[input.contentType]}`;
    return this.storage.createUploadUrl(key, input.contentType, input.size);
  }

  async save(admin: AdminPrincipal, input: SaveMapLayoutInput): Promise<AdminMapLayout> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const market = await this.prisma.market.findUniqueOrThrow({
      where: { id: marketId },
      select: { layoutVersion: true, mapBackgroundKey: true },
    });
    if (market.layoutVersion !== input.version) throw this.outdated(market.layoutVersion);

    // พื้นหลังใหม่: ต้องเป็นไฟล์ของตลาดนี้ที่อัปโหลดแล้วและเป็นรูปจริง
    const background = input.background;
    if (background && background.key !== market.mapBackgroundKey) {
      if (!background.key.startsWith(this.backgroundPrefix(marketId))) {
        throw new AppException(ErrorCode.VALIDATION_ERROR, 'Invalid background key');
      }
      const check = await checkUploadedImage(this.storage, background.key, (e) =>
        this.logger.warn(`Delete invalid background failed: ${String(e)}`),
      );
      if (check !== 'ok') {
        throw new AppException(ErrorCode.VALIDATION_ERROR, `Background image is ${check}`);
      }
    }

    let summary: { moved: number; created: number; features: number };
    try {
      summary = await this.prisma.$transaction(async (tx) => {
        // เพิ่ม version แบบมีเงื่อนไข — สองคนบันทึกพร้อมกัน ผ่านได้คนเดียว
        const bumped = await tx.market.updateMany({
          where: { id: marketId, layoutVersion: input.version },
          data: {
            layoutVersion: { increment: 1 },
            mapBackgroundKey: background?.key ?? null,
            mapBackgroundW: background?.width ?? null,
            mapBackgroundH: background?.height ?? null,
          },
        });
        if (bumped.count === 0) throw this.outdated();

        const moved = await this.moveStalls(tx, marketId, input.stalls);
        const created = await this.createStalls(tx, marketId, input.newStalls);

        // สัญลักษณ์: แทนทั้งชุด (ลำดับในรายการ = ลำดับการวาด)
        await tx.mapFeature.deleteMany({ where: { marketId } });
        await tx.mapFeature.createMany({
          data: input.features.map((f, i) => ({
            id: f.id ?? randomUUID(),
            marketId,
            kind: f.kind,
            label: f.label || null,
            posX: round2(f.posX),
            posY: round2(f.posY),
            width: round2(f.width),
            height: round2(f.height),
            rot: round2(f.rot),
            sortOrder: i,
          })),
        });

        await this.audit.log(
          {
            actorType: 'ADMIN',
            actorId: admin.id,
            action: 'market_layout.update',
            entity: { type: 'market', id: marketId },
            after: {
              version: input.version + 1,
              movedStalls: moved,
              newStalls: input.newStalls.map((s) => s.code),
              features: input.features.length,
              background: background?.key ?? null,
            },
          },
          tx,
        );
        return { moved, created, features: input.features.length };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppException(ErrorCode.STALL_CODE_TAKEN, 'Stall code already exists', {
          codes: input.newStalls.map((s) => s.code),
        });
      }
      throw error;
    }

    // ไฟล์พื้นหลังเดิมไม่ได้ใช้แล้ว
    if (market.mapBackgroundKey && market.mapBackgroundKey !== background?.key) {
      await this.storage
        .delete(market.mapBackgroundKey)
        .catch((e: unknown) => this.logger.warn(`Delete old background failed: ${String(e)}`));
    }
    this.logger.log(
      `Layout saved: ${summary.moved} moved, ${summary.created} new stalls, ${summary.features} features`,
    );
    return this.load(marketId);
  }

  /** อัปเดตเฉพาะล็อคที่ตำแหน่ง/ขนาด/การหมุนเปลี่ยน — ล็อคของตลาดอื่น/ไม่มีอยู่ = 404 */
  private async moveStalls(
    tx: Prisma.TransactionClient,
    marketId: string,
    stalls: SaveMapLayoutInput['stalls'],
  ): Promise<number> {
    if (stalls.length === 0) return 0;
    const current = await tx.stall.findMany({
      where: { marketId, id: { in: stalls.map((s) => s.id) } },
      select: { id: true, posX: true, posY: true, shapeW: true, shapeH: true, rot: true },
    });
    if (current.length !== stalls.length) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Stall not found');
    }
    const byId = new Map(current.map((s) => [s.id, s]));
    let moved = 0;
    for (const s of stalls) {
      const c = byId.get(s.id)!;
      if (
        same(c.posX, s.posX) &&
        same(c.posY, s.posY) &&
        same(c.shapeW, s.shapeW) &&
        same(c.shapeH, s.shapeH) &&
        same(c.rot, s.rot)
      ) {
        continue;
      }
      await tx.stall.update({
        where: { id: s.id },
        data: {
          posX: round2(s.posX),
          posY: round2(s.posY),
          shapeW: round2(s.shapeW),
          shapeH: round2(s.shapeH),
          rot: round2(s.rot),
        },
      });
      moved += 1;
    }
    return moved;
  }

  private async createStalls(
    tx: Prisma.TransactionClient,
    marketId: string,
    stalls: SaveMapLayoutInput['newStalls'],
  ): Promise<number> {
    if (stalls.length === 0) return 0;
    const zoneIds = [...new Set(stalls.map((s) => s.zoneId))];
    const zones = await tx.zone.count({ where: { marketId, id: { in: zoneIds } } });
    if (zones !== zoneIds.length) throw new AppException(ErrorCode.NOT_FOUND, 'Zone not found');
    const { count } = await tx.stall.createMany({
      data: stalls.map((s) => ({
        marketId,
        zoneId: s.zoneId,
        code: s.code,
        widthM: s.widthM,
        lengthM: s.lengthM,
        price: s.price,
        posX: round2(s.posX),
        posY: round2(s.posY),
        shapeW: round2(s.shapeW),
        shapeH: round2(s.shapeH),
        rot: round2(s.rot),
      })),
    });
    return count;
  }

  private async load(marketId: string): Promise<AdminMapLayout> {
    const [market, zones, stalls, features] = await Promise.all([
      this.prisma.market.findUniqueOrThrow({
        where: { id: marketId },
        select: {
          layoutVersion: true,
          mapBackgroundKey: true,
          mapBackgroundW: true,
          mapBackgroundH: true,
        },
      }),
      this.prisma.zone.findMany({
        where: { marketId },
        select: { id: true, name: true, color: true, sortOrder: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.stall.findMany({
        where: { marketId },
        select: {
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
        },
      }),
      this.features(marketId),
    ]);
    const background = await this.background(market);
    return {
      version: market.layoutVersion,
      zones,
      stalls: stalls
        .sort(compareStalls)
        .map(({ isActive, isReserved, ...s }) => ({ ...toMapStall(s), isActive, isReserved })),
      features,
      background: background && { ...background, key: market.mapBackgroundKey! },
    };
  }

  private async features(marketId: string): Promise<MapFeature[]> {
    const rows = await this.prisma.mapFeature.findMany({
      where: { marketId },
      select: FEATURE_FIELDS,
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(toFeature);
  }

  private async background(market: {
    mapBackgroundKey: string | null;
    mapBackgroundW: number | null;
    mapBackgroundH: number | null;
  }): Promise<MapBackground | null> {
    if (!market.mapBackgroundKey || !market.mapBackgroundW || !market.mapBackgroundH) return null;
    return {
      url: await this.storage.createDownloadUrl(market.mapBackgroundKey),
      width: market.mapBackgroundW,
      height: market.mapBackgroundH,
    };
  }

  private backgroundPrefix(marketId: string): string {
    return `markets/${marketId}/layout/`;
  }

  private outdated(current?: number): AppException {
    return new AppException(
      ErrorCode.LAYOUT_OUTDATED,
      'Layout was saved by someone else',
      current === undefined ? undefined : { version: current },
    );
  }
}
