import type { AppConfigService } from '../../../config/app-config.service';
import { DeliveryError } from '../delivery-error';
import { THAIBULKSMS_URL, ThaiBulkSmsProvider } from './thaibulksms.provider';

const env: Record<string, string | undefined> = {
  SMS_API_KEY: 'key',
  SMS_API_SECRET: 'secret',
  SMS_SENDER: 'MARKET',
  SMS_CREDIT_TYPE: 'corporate',
};
const config = { get: (k: string) => env[k] } as unknown as AppConfigService;

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ThaiBulkSmsProvider', () => {
  const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
  const provider = new ThaiBulkSmsProvider(config);

  beforeEach(() => {
    fetchMock.mockReset();
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock);
  });

  afterEach(() => jest.restoreAllMocks());

  it('posts a form with basic auth, sender and credit type', async () => {
    fetchMock.mockResolvedValue(
      reply(201, { phone_number_list: [{ number: '66812345678', message_id: 'm1' }] }),
    );

    await provider.send({ to: '0812345678', text: 'สวัสดี' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(THAIBULKSMS_URL);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('key:secret').toString('base64')}`,
    );
    const form = init?.body as URLSearchParams;
    expect(Object.fromEntries(form)).toEqual({
      msisdn: '0812345678',
      message: 'สวัสดี',
      sender: 'MARKET',
      force: 'corporate',
    });
  });

  it.each([
    [500, 'ERROR_SYSTEM_FAILURE', true],
    [429, 'ERROR_TOO_MANY_REQUESTS', true],
    [423, 'ERROR_INSUFFICIENT_CREDIT', true],
    [400, 'ERROR_SENDER_NOT_FOUND', false],
    [401, 'ERROR_AUTHENTICATION_FAILED', false],
  ])('HTTP %i (%s) → retryable=%s', async (status, name, retryable) => {
    fetchMock.mockResolvedValue(reply(status, { error: { code: 1, name, description: 'x' } }));

    const error = await provider.send({ to: '0812345678', text: 'x' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DeliveryError);
    expect((error as DeliveryError).retryable).toBe(retryable);
    expect((error as DeliveryError).message).toContain(name);
  });

  it('network failure is retryable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const error = await provider.send({ to: '0812345678', text: 'x' }).catch((e: unknown) => e);

    expect((error as DeliveryError).retryable).toBe(true);
  });

  it('a number in bad_phone_number_list is not retried', async () => {
    fetchMock.mockResolvedValue(
      reply(201, {
        phone_number_list: [],
        bad_phone_number_list: [{ number: '0800', message: 'Phone number is invalid.' }],
      }),
    );

    const error = await provider.send({ to: '0800', text: 'x' }).catch((e: unknown) => e);

    expect((error as DeliveryError).retryable).toBe(false);
  });

  it('never puts the message text into the error (may contain an OTP)', async () => {
    fetchMock.mockResolvedValue(reply(400, { error: { name: 'ERROR_MESSAGE' } }));

    const error = await provider
      .send({ to: '0812345678', text: 'รหัส OTP 123456' })
      .catch((e: unknown) => e);

    expect(String((error as Error).message)).not.toContain('123456');
  });
});
