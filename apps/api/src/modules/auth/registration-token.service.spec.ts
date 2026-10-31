import { JwtService } from '@nestjs/jwt';
import { AppException } from '../../common/exceptions/app.exception';
import type { AppConfigService } from '../../config/app-config.service';
import { RegistrationTokenService } from './registration-token.service';
import { TokenService } from './token.service';

const config = {
  get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? 'unit-test-secret' : undefined),
} as unknown as AppConfigService;

describe('RegistrationTokenService', () => {
  const jwt = new JwtService({});
  const registration = new RegistrationTokenService(jwt, config);
  const access = new TokenService(jwt, config);

  it('round-trips the verified claims', () => {
    const claims = {
      marketId: 'm1',
      verifiedPhone: '0812345678',
      lineUserId: 'U1',
      lineDisplayName: 'A',
    };

    expect(registration.verify(registration.sign(claims))).toEqual({
      ...claims,
      registrationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('keeps the registration id when re-signed (LINE → OTP)', () => {
    const first = registration.verify(registration.sign({ marketId: 'm1', lineUserId: 'U1' }));
    const second = registration.verify(
      registration.sign({
        registrationId: first.registrationId,
        marketId: 'm1',
        verifiedPhone: '0812345678',
      }),
    );

    expect(second.registrationId).toBe(first.registrationId);
  });

  it('cannot be used as an access token (different audience)', () => {
    const token = registration.sign({ marketId: 'm1', verifiedPhone: '0812345678' });

    expect(access.verifyAccessToken(token)).toBeNull();
  });

  it('does not accept an access token as a registration token', () => {
    const token = access.signAccessToken({ actorType: 'VENDOR', id: 'v1', marketId: 'm1' });

    expect(() => registration.verify(token)).toThrow(AppException);
  });

  it('rejects garbage', () => {
    expect(() => registration.verify('garbage')).toThrow(AppException);
  });
});
