import { AppException } from '../../../common/exceptions/app.exception';
import type { AppConfigService } from '../../../config/app-config.service';
import { HttpLineIdTokenVerifier, LINE_VERIFY_URL } from './line-id-token.verifier';

const configWith = (channelId?: string) =>
  ({
    get: (key: string) => (key === 'LINE_LOGIN_CHANNEL_ID' ? channelId : undefined),
  }) as unknown as AppConfigService;

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (e) {
    return e instanceof AppException ? e.code : 'unknown error';
  }
}

describe('HttpLineIdTokenVerifier', () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch');
  const future = Math.floor(Date.now() / 1000) + 600;

  afterEach(() => fetchMock.mockReset());
  afterAll(() => fetchMock.mockRestore());

  it('posts the token and channel id to LINE and returns the identity', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { sub: 'U123', aud: 'chan', exp: future, name: 'สมชาย' }),
    );

    const identity = await new HttpLineIdTokenVerifier(configWith('chan')).verify('id-token');

    expect(identity).toEqual({ userId: 'U123', displayName: 'สมชาย' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(LINE_VERIFY_URL);
    expect(String(init?.body)).toBe('id_token=id-token&client_id=chan');
  });

  it('is SERVICE_UNAVAILABLE when LINE Login is not configured (without calling LINE)', async () => {
    expect(await codeOf(new HttpLineIdTokenVerifier(configWith(undefined)).verify('t'))).toBe(
      'SERVICE_UNAVAILABLE',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is UNAUTHORIZED when LINE rejects the token (400)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'invalid_request' }));

    expect(await codeOf(new HttpLineIdTokenVerifier(configWith('chan')).verify('t'))).toBe(
      'UNAUTHORIZED',
    );
  });

  it.each([
    ['another channel', { sub: 'U1', aud: 'other', exp: future }],
    ['expired', { sub: 'U1', aud: 'chan', exp: 1 }],
    ['missing sub', { aud: 'chan', exp: future }],
  ])('is UNAUTHORIZED for a token from %s', async (_name, body) => {
    fetchMock.mockResolvedValue(jsonResponse(200, body));

    expect(await codeOf(new HttpLineIdTokenVerifier(configWith('chan')).verify('t'))).toBe(
      'UNAUTHORIZED',
    );
  });

  it('is SERVICE_UNAVAILABLE when LINE is down or unreachable', async () => {
    const verifier = new HttpLineIdTokenVerifier(configWith('chan'));

    fetchMock.mockResolvedValue(jsonResponse(502, {}));
    expect(await codeOf(verifier.verify('t'))).toBe('SERVICE_UNAVAILABLE');

    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(await codeOf(verifier.verify('t'))).toBe('SERVICE_UNAVAILABLE');
  });
});
