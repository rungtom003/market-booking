import type { MapFeatureKind } from '@market-booking/shared';

export interface FeatureStyle {
  fill: string;
  stroke: string;
  /** สีตัวอักษร/สัญลักษณ์ */
  text: string;
  /** ข้อความสั้นกลางป้าย (ทางเดิน/ข้อความไม่มี) */
  glyph: string | null;
}

/** หน้าตาของทางเดิน/สัญลักษณ์ — ใช้ทั้ง StallMap (SVG) และ Map Editor (Konva) ให้เหมือนกัน */
export const FEATURE_STYLE: Record<MapFeatureKind, FeatureStyle> = {
  WALKWAY: { fill: '#E2E8F0', stroke: '#CBD5E1', text: '#64748B', glyph: null },
  TOILET: { fill: '#DBEAFE', stroke: '#2563EB', text: '#1D4ED8', glyph: 'WC' },
  ENTRANCE: { fill: '#DCFCE7', stroke: '#16A34A', text: '#15803D', glyph: 'เข้า' },
  EXIT: { fill: '#FEE2E2', stroke: '#DC2626', text: '#B91C1C', glyph: 'ออก' },
  PARKING: { fill: '#E0E7FF', stroke: '#4F46E5', text: '#4338CA', glyph: 'P' },
  LABEL: { fill: 'transparent', stroke: 'transparent', text: '#334155', glyph: null },
};

/** ขนาดตัวอักษรของ glyph/ข้อความให้พอดีกล่อง */
export function featureFontSize(width: number, height: number, text: string): number {
  const byWidth = width / Math.max(1, text.length * 0.62 + 0.4);
  return Math.max(8, Math.min(byWidth, height * 0.55));
}
