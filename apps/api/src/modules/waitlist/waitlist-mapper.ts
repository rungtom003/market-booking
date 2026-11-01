import type { AdminWaitlistEntry, WaitlistEntry, WaitlistStatus } from '@market-booking/shared';
import type { Prisma } from '../../generated/prisma/client';

export const ENTRY_FIELDS = {
  id: true,
  vendorId: true,
  marketDayId: true,
  stallId: true,
  zoneId: true,
  position: true,
  status: true,
  expiresAt: true,
  offerBookingId: true,
  createdAt: true,
  marketDay: { select: { marketDate: true, round: { select: { name: true } } } },
  stall: { select: { id: true, code: true } },
  zone: { select: { id: true, name: true } },
} satisfies Prisma.WaitlistSelect;

export type EntryRow = Prisma.WaitlistGetPayload<{ select: typeof ENTRY_FIELDS }>;

/** คิวที่ยังมีผล (กันซ้ำ/นับโควตา) */
export const OPEN_STATUSES: WaitlistStatus[] = ['WAITING', 'NOTIFIED'];

export function toEntry(row: EntryRow, ahead: number): WaitlistEntry {
  return {
    id: row.id,
    marketDay: {
      id: row.marketDayId,
      marketDate: row.marketDay.marketDate.toISOString().slice(0, 10),
      roundName: row.marketDay.round.name,
    },
    stall: row.stall,
    // คิวเจาะจงล็อคก็เก็บโซนของล็อคไว้ด้วยเสมอ
    zone: row.zone!,
    status: row.status,
    ahead,
    bookingId: row.status === 'NOTIFIED' ? row.offerBookingId : null,
    expiresAt: row.status === 'NOTIFIED' ? (row.expiresAt?.toISOString() ?? null) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const ADMIN_ENTRY_FIELDS = {
  ...ENTRY_FIELDS,
  vendor: {
    select: { id: true, firstName: true, lastName: true, shopName: true, phone: true },
  },
} satisfies Prisma.WaitlistSelect;

export type AdminEntryRow = Prisma.WaitlistGetPayload<{ select: typeof ADMIN_ENTRY_FIELDS }>;

export function toAdminEntry(row: AdminEntryRow, ahead: number): AdminWaitlistEntry {
  return {
    ...toEntry(row, ahead),
    position: row.position,
    vendor: {
      id: row.vendor.id,
      name: `${row.vendor.firstName} ${row.vendor.lastName}`,
      shopName: row.vendor.shopName,
      phone: row.vendor.phone,
    },
  };
}

/**
 * จำนวนคิว WAITING ก่อนหน้า `row` ที่แย่งสิทธิ์เดียวกัน:
 * คิวล็อค = คิวล็อคเดียวกัน + คิวทั้งโซนของล็อคนั้น; คิวโซน = ทุกคิวในโซนนั้น
 */
export function aheadOf(
  row: {
    id: string;
    stallId: string | null;
    zoneId: string | null;
    position: number;
    status: string;
  },
  waiting: readonly {
    id: string;
    stallId: string | null;
    zoneId: string | null;
    position: number;
  }[],
): number {
  if (row.status !== 'WAITING') return 0;
  return waiting.filter(
    (w) =>
      w.id !== row.id &&
      w.position < row.position &&
      (row.stallId
        ? w.stallId === row.stallId || (w.stallId === null && w.zoneId === row.zoneId)
        : w.zoneId === row.zoneId),
  ).length;
}
