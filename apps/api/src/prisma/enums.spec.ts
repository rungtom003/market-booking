import * as shared from '@market-booking/shared';
import * as db from '../generated/prisma/enums';

// enum มี 2 ที่: Prisma (DB) และ packages/shared (frontend ใช้) — test นี้กันไม่ให้ค่าเพี้ยนกัน
const pairs = [
  ['VendorStatus', db.VendorStatus, shared.VendorStatus],
  ['AdminRole', db.AdminRole, shared.AdminRole],
  ['RoundStatus', db.RoundStatus, shared.RoundStatus],
  ['BookingStatus', db.BookingStatus, shared.BookingStatus],
  ['PaymentStatus', db.PaymentStatus, shared.PaymentStatus],
  ['WaitlistStatus', db.WaitlistStatus, shared.WaitlistStatus],
] as const;

describe('Prisma enums match packages/shared', () => {
  it.each(pairs)('%s', (_name, prismaEnum, sharedEnum) => {
    expect(Object.values(prismaEnum).sort()).toEqual(Object.values(sharedEnum).sort());
  });
});
