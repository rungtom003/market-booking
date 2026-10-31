import { Controller, ExecutionContext, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from '@market-booking/shared';
import { AppException } from '../../../common/exceptions/app.exception';
import { ActorTypes, RequirePermission, Roles } from '../decorators';
import type { Principal } from '../principal';
import { AccessGuard } from './access.guard';

@Controller()
class Handlers {
  @RequirePermission(Permission.SETTINGS_MANAGE)
  @Get()
  settings() {}

  @Roles('FINANCE')
  @Get()
  financeOnly() {}

  @ActorTypes('VENDOR')
  @Get()
  vendorOnly() {}

  @Get()
  anyone() {}
}

function contextFor(handler: keyof Handlers, principal: Principal | undefined, path = '/api/v1/x') {
  return {
    getType: () => 'http',
    getHandler: () => Handlers.prototype[handler],
    getClass: () => Handlers,
    switchToHttp: () => ({ getRequest: () => ({ principal, path }) }),
  } as unknown as ExecutionContext;
}

const admin = (role: 'SUPER_ADMIN' | 'ADMIN' | 'STAFF' | 'FINANCE'): Principal => ({
  actorType: 'ADMIN',
  id: 'a1',
  role,
  marketId: null,
});
const vendor: Principal = { actorType: 'VENDOR', id: 'v1', marketId: 'm1' };

describe('AccessGuard', () => {
  const guard = new AccessGuard(new Reflector());
  const allowed = (ctx: ExecutionContext) => {
    try {
      return guard.canActivate(ctx);
    } catch (e) {
      if (e instanceof AppException && e.code === 'FORBIDDEN') return false;
      throw e;
    }
  };

  it('applies the permission table (STAFF cannot manage settings, ADMIN can)', () => {
    expect(allowed(contextFor('settings', admin('STAFF')))).toBe(false);
    expect(allowed(contextFor('settings', admin('FINANCE')))).toBe(false);
    expect(allowed(contextFor('settings', admin('ADMIN')))).toBe(true);
    expect(allowed(contextFor('settings', admin('SUPER_ADMIN')))).toBe(true);
  });

  it('never lets vendors through role-restricted handlers', () => {
    expect(allowed(contextFor('settings', vendor))).toBe(false);
  });

  it('checks explicit roles', () => {
    expect(allowed(contextFor('financeOnly', admin('FINANCE')))).toBe(true);
    expect(allowed(contextFor('financeOnly', admin('SUPER_ADMIN')))).toBe(false);
  });

  it('restricts actor types', () => {
    expect(allowed(contextFor('vendorOnly', vendor))).toBe(true);
    expect(allowed(contextFor('vendorOnly', admin('SUPER_ADMIN')))).toBe(false);
  });

  it('blocks vendors from any /admin/* path even without decorators', () => {
    expect(allowed(contextFor('anyone', vendor, '/api/v1/admin/vendors'))).toBe(false);
    expect(allowed(contextFor('anyone', admin('STAFF'), '/api/v1/admin/vendors'))).toBe(true);
    expect(allowed(contextFor('anyone', vendor, '/api/v1/bookings/me'))).toBe(true);
  });

  it('skips public handlers (no principal)', () => {
    expect(allowed(contextFor('settings', undefined))).toBe(true);
  });
});
