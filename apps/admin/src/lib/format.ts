import type { AdminRole, VendorStatus } from '@market-booking/shared';

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

export const VENDOR_STATUS_TH: Record<VendorStatus, string> = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  SUSPENDED: 'ระงับ',
};

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
