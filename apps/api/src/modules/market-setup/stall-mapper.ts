import type { MapStall } from '@market-booking/shared';
import type { Prisma } from '../../generated/prisma/client';

type DecimalLike = Prisma.Decimal | number;

export interface StallGeometryRow {
  id: string;
  zoneId: string;
  code: string;
  widthM: DecimalLike;
  lengthM: DecimalLike;
  price: DecimalLike;
  posX: DecimalLike;
  posY: DecimalLike;
  rot: DecimalLike;
  shapeW: DecimalLike;
  shapeH: DecimalLike;
}

/** Decimal ของ DB → number ใน JSON (ทุกค่ามีทศนิยม 2 ตำแหน่ง แสดงผลได้แม่นพอ) */
export function toMapStall(row: StallGeometryRow): MapStall {
  return {
    id: row.id,
    zoneId: row.zoneId,
    code: row.code,
    widthM: Number(row.widthM),
    lengthM: Number(row.lengthM),
    price: Number(row.price),
    posX: Number(row.posX),
    posY: Number(row.posY),
    rot: Number(row.rot),
    shapeW: Number(row.shapeW),
    shapeH: Number(row.shapeH),
  };
}

const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });

/** เรียงรหัสล็อคแบบตัวเลข: A2 ก่อน A10 */
export function compareStalls(a: { code: string }, b: { code: string }): number {
  return collator.compare(a.code, b.code);
}
