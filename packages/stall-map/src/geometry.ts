export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StallShape {
  posX: number;
  posY: number;
  shapeW: number;
  shapeH: number;
  rot: number;
}

/**
 * กรอบที่ครอบล็อคทุกตัว (เผื่อการหมุนด้วยรัศมีวงกลมล้อมรอบ) + ขอบ `padding`
 * `extra` = กล่องอื่นที่ต้องอยู่ในกรอบด้วย (พื้นหลัง, สัญลักษณ์)
 */
export function fitViewBox(
  stalls: StallShape[],
  padding = 20,
  extra: readonly StallShape[] = [],
): ViewBox {
  const shapes = extra.length > 0 ? [...stalls, ...extra] : stalls;
  if (shapes.length === 0) return { x: 0, y: 0, w: 400, h: 300 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    const cx = s.posX + s.shapeW / 2;
    const cy = s.posY + s.shapeH / 2;
    // ไม่หมุน = ใช้กรอบจริง; หมุน = ใช้รัศมีที่ครอบได้ทุกมุม
    const rx = s.rot % 180 === 0 ? s.shapeW / 2 : Math.hypot(s.shapeW, s.shapeH) / 2;
    const ry = s.rot % 180 === 0 ? s.shapeH / 2 : rx;
    minX = Math.min(minX, cx - rx);
    minY = Math.min(minY, cy - ry);
    maxX = Math.max(maxX, cx + rx);
    maxY = Math.max(maxY, cy + ry);
  }
  return {
    x: minX - padding,
    y: minY - padding,
    w: maxX - minX + padding * 2,
    h: maxY - minY + padding * 2,
  };
}

/** ขยาย `factor` เท่า (มากกว่า 1 = ซูมเข้า) โดยให้จุด (px, py) ในหน่วยผังอยู่ที่เดิมบนจอ */
export function zoomAt(
  vb: ViewBox,
  factor: number,
  px: number,
  py: number,
  limits: { minW: number; maxW: number },
): ViewBox {
  const w = clamp(vb.w / factor, limits.minW, limits.maxW);
  const scale = w / vb.w;
  return {
    x: px - (px - vb.x) * scale,
    y: py - (py - vb.y) * scale,
    w,
    h: vb.h * scale,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
