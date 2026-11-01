/**
 * สถานะที่ผังแสดงได้ — 3.1 ใช้ AVAILABLE/UNAVAILABLE (+ INACTIVE ฝั่ง admin)
 * Phase 4 เพิ่ม HELD/BOOKED/MINE จากการจอง, Phase 10 เพิ่ม CHECKED_IN (ผังวันขายฝั่ง admin)
 */
export type StallMapStatus =
  'AVAILABLE' | 'HELD' | 'BOOKED' | 'CHECKED_IN' | 'MINE' | 'UNAVAILABLE' | 'INACTIVE';

export const STALL_STATUS_LABEL_TH: Record<StallMapStatus, string> = {
  AVAILABLE: 'ว่าง',
  HELD: 'มีคนกำลังจอง',
  BOOKED: 'จองแล้ว',
  CHECKED_IN: 'เช็คอินแล้ว',
  MINE: 'ล็อคของฉัน',
  UNAVAILABLE: 'ไม่เปิดจอง',
  INACTIVE: 'ปิดใช้งาน',
};

export interface StallColors {
  fill: string;
  stroke: string;
  text: string;
  dash?: string;
}

/** ว่าง = สีโซนอ่อน + ขอบสีโซน; สถานะอื่นใช้สีกลาง เพื่อไม่ให้ชนกับสีโซน */
export function stallColors(
  status: StallMapStatus,
  zoneColor: string,
  selected = false,
): StallColors {
  const base: StallColors = (() => {
    switch (status) {
      case 'AVAILABLE':
        return { fill: `${zoneColor}33`, stroke: zoneColor, text: '#1F2937' };
      case 'MINE':
        return { fill: '#16A34A', stroke: '#15803D', text: '#FFFFFF' };
      case 'HELD':
        return { fill: '#FEF3C7', stroke: '#D97706', text: '#92400E', dash: '4 3' };
      case 'BOOKED':
        return { fill: '#94A3B8', stroke: '#64748B', text: '#FFFFFF' };
      case 'CHECKED_IN':
        return { fill: '#0F766E', stroke: '#115E59', text: '#FFFFFF' };
      case 'UNAVAILABLE':
        return { fill: '#E5E7EB', stroke: '#9CA3AF', text: '#6B7280', dash: '3 3' };
      case 'INACTIVE':
        return { fill: '#F3F4F6', stroke: '#D1D5DB', text: '#9CA3AF', dash: '2 4' };
    }
  })();
  return selected ? { ...base, stroke: '#111827' } : base;
}
