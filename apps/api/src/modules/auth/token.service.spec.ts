import { JwtService } from '@nestjs/jwt';
import type { AppConfigService } from '../../config/app-config.service';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants';
import type { AdminPrincipal, VendorPrincipal } from './principal';
import { TokenService } from './token.service';

const config = {
  get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? 'unit-test-secret' : undefined),
} as unknown as AppConfigService;

const admin: AdminPrincipal = { actorType: 'ADMIN', id: 'a1', role: 'STAFF', marketId: 'm1' };
const vendor: VendorPrincipal = { actorType: 'VENDOR', id: 'v1', marketId: 'm1' };

describe('TokenService', () => {
  const jwt = new JwtService({});
  const tokens = new TokenService(jwt, config);

  it.each([
    ['admin', admin],
    ['vendor', vendor],
  ])('round-trips a %s principal', (_name, principal) => {
    expect(tokens.verifyAccessToken(tokens.signAccessToken(principal))).toEqual(principal);
  });

  it('expires after 15 minutes', () => {
    const decoded = jwt.decode(tokens.signAccessToken(admin)) as { iat: number; exp: number };

    expect(decoded.exp - decoded.iat).toBe(ACCESS_TOKEN_TTL_SECONDS);
  });

  it('rejects tokens signed with another secret', () => {
    const forged = jwt.sign(
      { sub: 'a1', typ: 'ADMIN', role: 'SUPER_ADMIN', mkt: null },
      {
        secret: 'attacker-secret',
        issuer: 'market-booking',
      },
    );

    expect(tokens.verifyAccessToken(forged)).toBeNull();
  });

  it('rejects unsigned (alg: none) tokens', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({
        sub: 'a1',
        typ: 'ADMIN',
        role: 'SUPER_ADMIN',
        mkt: null,
        iss: 'market-booking',
      }),
    ).toString('base64url');

    expect(tokens.verifyAccessToken(`${header}.${body}.`)).toBeNull();
  });

  it('rejects expired tokens', () => {
    const expired = jwt.sign(
      {
        sub: 'a1',
        typ: 'ADMIN',
        role: 'STAFF',
        mkt: 'm1',
        exp: Math.floor(Date.now() / 1000) - 10,
      },
      { secret: 'unit-test-secret', issuer: 'market-booking' },
    );

    expect(tokens.verifyAccessToken(expired)).toBeNull();
  });

  it('rejects malformed payloads (admin without role, vendor without market)', () => {
    const sign = (payload: object) =>
      jwt.sign(payload, { secret: 'unit-test-secret', issuer: 'market-booking' });

    expect(tokens.verifyAccessToken(sign({ sub: 'a1', typ: 'ADMIN', mkt: null }))).toBeNull();
    expect(tokens.verifyAccessToken(sign({ sub: 'v1', typ: 'VENDOR', mkt: null }))).toBeNull();
    expect(tokens.verifyAccessToken('not-a-jwt')).toBeNull();
  });
});
