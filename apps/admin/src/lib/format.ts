import type { AdminRole, RoundPhase, RoundStatus, VendorStatus } from '@market-booking/shared';

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

const baht = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });

/** 1500 → "1,500 บาท" */
export function formatBaht(amount: number): string {
  return `${baht.format(amount)} บาท`;
}

export function formatPhone(phone: string): string {
  return phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
}

/** ย้ายไป shared (ไฟล์ export ของ API ใช้ด้วย) */
export { VENDOR_STATUS_TH } from '@market-booking/shared';

export const VENDOR_STATUS_COLOR = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
  SUSPENDED: 'default',
} as const satisfies Record<VendorStatus, string>;

export const ADMIN_ROLE_TH: Record<AdminRole, string> = {
  SUPER_ADMIN: 'ผู้ดูแลสูงสุด',
  ADMIN: 'ผู้ดูแล',
  STAFF: 'เจ้าหน้าที่',
  FINANCE: 'การเงิน',
};

// ───────────── รอบการจอง ─────────────

/** ตลาดใช้เวลาไทย (UTC+7 ไม่มี DST) — ช่อง datetime-local กรอก/แสดงเป็นเวลาไทยเสมอไม่ว่าเครื่องตั้ง timezone อะไร */
const BANGKOK_OFFSET_MS = 7 * 3_600_000;

/** ISO → ค่าของ `<input type="datetime-local">` (เวลาไทย) เช่น "2026-12-01T10:00" */
export function toBangkokInput(iso: string): string {
  return new Date(Date.parse(iso) + BANGKOK_OFFSET_MS).toISOString().slice(0, 16);
}

/** ค่าจาก `<input type="datetime-local">` (เวลาไทย) → ISO; ว่าง/ผิดรูปแบบ = "" ให้ schema แจ้ง */
export function fromBangkokInput(value: string): string {
  const ms = Date.parse(`${value}:00+07:00`);
  return Number.isNaN(ms) ? '' : new Date(ms).toISOString();
}

/** วันแรกที่ใช้เป็นวันขายได้: เริ่มวัน (00:00 เวลาไทย) ไม่ก่อนเวลาปิดจอง และไม่ก่อนวันนี้ */
export function firstAllowedMarketDate(closeAtIso: string, now = Date.now()): string {
  const bangkokDate = (ms: number) => new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
  const closeAt = Date.parse(closeAtIso);
  let date = bangkokDate(closeAt);
  if (Date.parse(`${date}T00:00:00+07:00`) < closeAt) date = bangkokDate(closeAt + 86_400_000);
  const today = bangkokDate(now);
  return date < today ? today : date;
}

/** สถานะที่แสดง: DRAFT/CANCELLED หรือ phase ของรอบที่เผยแพร่แล้ว */
export function roundStateChip(round: { status: RoundStatus; phase: RoundPhase | null }): {
  label: string;
  color: 'default' | 'info' | 'success' | 'error' | 'warning';
} {
  if (round.status === 'DRAFT') return { label: 'ร่าง', color: 'warning' };
  if (round.status === 'CANCELLED') return { label: 'ยกเลิกแล้ว', color: 'error' };
  switch (round.phase) {
    case 'UPCOMING':
      return { label: 'รอเปิดจอง', color: 'info' };
    case 'OPEN':
      return { label: 'เปิดจองอยู่', color: 'success' };
    default:
      return { label: 'ปิดจองแล้ว', color: 'default' };
  }
}
