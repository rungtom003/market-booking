import type { AdminMapLayout, MapFeatureKind, SaveMapLayoutInput } from '@market-booking/shared';

/** กล่องบนผัง (มุมซ้ายบน + ขนาด + องศาหมุนรอบจุดกลาง) — หน่วย px ของ canvas เหมือน API */
export interface Box {
  posX: number;
  posY: number;
  w: number;
  h: number;
  rot: number;
}

export interface EditorStall extends Box {
  /** id ของล็อค หรือ `new:<uuid>` สำหรับล็อคที่วาง/คัดลอกในผังและยังไม่บันทึก */
  key: string;
  type: 'stall';
  zoneId: string;
  code: string;
  isActive: boolean;
  isNew: boolean;
  price: number;
  widthM: number;
  lengthM: number;
}

export interface EditorFeature extends Box {
  key: string;
  type: 'feature';
  kind: MapFeatureKind;
  label: string | null;
}

export type EditorItem = EditorStall | EditorFeature;

export interface EditorBackground {
  /** key ใน MinIO (ส่งตอนบันทึก) */
  key: string;
  /** presigned URL หรือ blob URL ของรูปที่เพิ่งเลือก */
  url: string;
  width: number;
  height: number;
}

/** สถานะของผังทั้งชุดใน editor — เก็บเป็นก้อนเดียวเพื่อ undo/redo */
export interface EditorDoc {
  stalls: EditorStall[];
  features: EditorFeature[];
  background: EditorBackground | null;
}

export function docFromLayout(layout: AdminMapLayout): EditorDoc {
  return {
    stalls: layout.stalls.map((s) => ({
      key: s.id,
      type: 'stall',
      zoneId: s.zoneId,
      code: s.code,
      isActive: s.isActive,
      isNew: false,
      price: s.price,
      widthM: s.widthM,
      lengthM: s.lengthM,
      posX: s.posX,
      posY: s.posY,
      w: s.shapeW,
      h: s.shapeH,
      rot: s.rot,
    })),
    features: layout.features.map((f) => ({
      key: f.id,
      type: 'feature',
      kind: f.kind,
      label: f.label,
      posX: f.posX,
      posY: f.posY,
      w: f.width,
      h: f.height,
      rot: f.rot,
    })),
    background: layout.background && {
      key: layout.background.key,
      url: layout.background.url,
      width: layout.background.width,
      height: layout.background.height,
    },
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** API ไม่รับตำแหน่งติดลบ */
const pos = (n: number) => Math.max(0, r2(n));

export function toSaveInput(doc: EditorDoc, version: number): SaveMapLayoutInput {
  return {
    version,
    stalls: doc.stalls
      .filter((s) => !s.isNew)
      .map((s) => ({
        id: s.key,
        posX: pos(s.posX),
        posY: pos(s.posY),
        shapeW: r2(s.w),
        shapeH: r2(s.h),
        rot: r2(s.rot),
      })),
    newStalls: doc.stalls
      .filter((s) => s.isNew)
      .map((s) => ({
        zoneId: s.zoneId,
        code: s.code,
        widthM: s.widthM,
        lengthM: s.lengthM,
        price: s.price,
        posX: pos(s.posX),
        posY: pos(s.posY),
        shapeW: r2(s.w),
        shapeH: r2(s.h),
        rot: r2(s.rot),
      })),
    features: doc.features.map((f) => ({
      // สัญลักษณ์ที่เพิ่งเพิ่มใช้ key ชั่วคราว — ไม่ส่ง id ให้ server สร้างใหม่
      ...(f.key.startsWith('new:') ? {} : { id: f.key }),
      kind: f.kind,
      label: f.label?.trim() || null,
      posX: pos(f.posX),
      posY: pos(f.posY),
      width: r2(f.w),
      height: r2(f.h),
      rot: r2(f.rot),
    })),
    background: doc.background && {
      key: doc.background.key,
      width: Math.round(doc.background.width),
      height: Math.round(doc.background.height),
    },
  };
}

export const snapTo = (value: number, grid: number) =>
  grid > 0 ? Math.round(value / grid) * grid : value;

/** มุม 0/90/180/270 แบบดูดเข้าหาเมื่อใกล้ (องศา) */
export function snapAngle(rot: number, step = 15): number {
  const normalized = ((rot % 360) + 360) % 360;
  const snapped = Math.round(normalized / step) * step;
  return snapped >= 360 ? 0 : snapped > 180 ? snapped - 360 : snapped;
}

/**
 * รหัสถัดไปที่ยังว่างตามรูปแบบเดิม: A10 → A11 (ถ้า A11 มีแล้ว → A12 ...)
 * รหัสที่ไม่ลงท้ายด้วยเลข → ต่อท้าย -2, -3 ...
 */
export function nextFreeCode(code: string, taken: ReadonlySet<string>): string {
  const m = /^(.*?)(\d+)$/.exec(code);
  const prefix = m ? m[1]! : `${code}-`;
  let n = m ? Number(m[2]) + 1 : 2;
  while (taken.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

/** กล่องล้อมรอบ (ไม่คิดการหมุน) ของหลายรายการ */
export function boundsOf(items: readonly Box[]): Box | null {
  if (items.length === 0) return null;
  const minX = Math.min(...items.map((i) => i.posX));
  const minY = Math.min(...items.map((i) => i.posY));
  const maxX = Math.max(...items.map((i) => i.posX + i.w));
  const maxY = Math.max(...items.map((i) => i.posY + i.h));
  return { posX: minX, posY: minY, w: maxX - minX, h: maxY - minY, rot: 0 };
}

/** ขนาดเริ่มต้นของสัญลักษณ์ใหม่ */
export const NEW_FEATURE_SIZE: Record<MapFeatureKind, { w: number; h: number }> = {
  WALKWAY: { w: 300, h: 40 },
  TOILET: { w: 50, h: 50 },
  ENTRANCE: { w: 60, h: 50 },
  EXIT: { w: 60, h: 50 },
  PARKING: { w: 50, h: 50 },
  LABEL: { w: 160, h: 40 },
};

export function newKey(): string {
  return `new:${crypto.randomUUID()}`;
}

export function itemsOf(doc: EditorDoc): EditorItem[] {
  return [...doc.features, ...doc.stalls];
}
