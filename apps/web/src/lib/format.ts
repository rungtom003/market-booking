import type { BookingStatus, StallDayStatus } from '@market-booking/shared';
import type { StallMapStatus } from '@market-booking/stall-map';

/** วันที่แบบไทย เวลา Asia/Bangkok (Overview §13) เช่น "7 พ.ย. 2569 14:30" */
export function formatThaiDateTime(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** 0812345678 → 081-234-5678 */
export function formatPhone(phone: string): string {
  return phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
}

const baht = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });

/** 1500 → "1,500 บาท" */
export function formatBaht(amount: number): string {
  return `${baht.format(amount)} บาท`;
}

/** สีป้ายสถานะ (Tailwind) */
export const BOOKING_STATUS_STYLE: Record<BookingStatus, string> = {
  HOLD: 'bg-amber-100 text-amber-900',
  PENDING_PAYMENT: 'bg-blue-100 text-blue-800',
  PENDING_VERIFY: 'bg-blue-100 text-blue-800',
  CONFIRMED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-gray-100 text-gray-600',
  EXPIRED: 'bg-gray-100 text-gray-600',
};

/** สถานะล็อคจาก API → สีบนผัง (ของฉันเป็นสีเขียวเข้มไม่ว่าจะรอยืนยันหรือจองแล้ว) */
export function toMapStatus(s: { status: StallDayStatus; mine: boolean }): StallMapStatus {
  switch (s.status) {
    case 'AVAILABLE':
      return 'AVAILABLE';
    case 'HOLD':
      return s.mine ? 'MINE' : 'HELD';
    case 'BOOKED':
      return s.mine ? 'MINE' : 'BOOKED';
    case 'CLOSED':
      return 'UNAVAILABLE';
  }
}

/** `2026-12-10` → "พฤ. 10 ธ.ค." (ปุ่มเลือกวันขาย — ไม่มีปี ให้พอดีปุ่มบนมือถือ) */
export function formatShortDateTh(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('th-TH', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
