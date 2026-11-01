import { AdminRole, Permission, hasPermission, permissionsOf } from '@market-booking/shared';

// ตาราง Permission ใน Overview §2 เขียนซ้ำไว้ตรงนี้โดยตั้งใจ — ถ้ามีใครแก้ PERMISSION_ROLES ผิด test จะจับได้
//                          SUPER  ADMIN  STAFF  FINANCE
const EXPECTED: Record<Permission, [boolean, boolean, boolean, boolean]> = {
  ADMIN_USERS_MANAGE: [true, false, false, false],
  SETTINGS_MANAGE: [true, true, false, false],
  VENDORS_REVIEW: [true, true, true, false],
  MARKET_LAYOUT_MANAGE: [true, true, false, false],
  ROUNDS_MANAGE: [true, true, false, false],
  BOOKINGS_CANCEL: [true, true, true, false],
  PAYMENTS_VERIFY: [true, true, false, true],
  REPORTS_VIEW: [true, true, true, true],
  CHECKIN: [true, true, true, false],
  VENDOR_PHONE_VIEW: [true, true, true, false],
  ANNOUNCEMENTS_MANAGE: [true, true, false, false],
  AUDIT_LOG_VIEW: [true, true, false, false],
};

const ROLES = [AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.STAFF, AdminRole.FINANCE];

describe('permission table (Overview §2)', () => {
  it('covers every permission', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.values(Permission).sort());
  });

  it.each(Object.entries(EXPECTED))('%s', (permission, allowed) => {
    ROLES.forEach((role, i) => {
      expect([role, hasPermission(role, permission as Permission)]).toEqual([role, allowed[i]]);
    });
  });

  it('lists permissions per role for the admin UI', () => {
    expect(permissionsOf(AdminRole.FINANCE).sort()).toEqual(['PAYMENTS_VERIFY', 'REPORTS_VIEW']);
    expect(permissionsOf(AdminRole.SUPER_ADMIN)).toHaveLength(Object.keys(Permission).length);
  });
});
