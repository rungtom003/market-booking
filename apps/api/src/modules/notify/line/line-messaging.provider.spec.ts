import { createHmac } from 'node:crypto';
import type { AppConfigService } from '../../../config/app-config.service';
import { DeliveryError } from '../delivery-error';
import { LINE_PUSH_URL, LineMessagingProvider, toFlexMessage } from './line-messaging.provider';
import { lineSignatureValid } from './line-webhook.controller';

function provider(token: string | null = 'line-token') {
  const config = { get: () => token ?? undefined } as unknown as AppConfigService;
  return new LineMessagingProvider(config);
}

const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('LineMessagingProvider', () => {
  const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();

  beforeEach(() => {
    fetchMock.mockReset();
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock);
  });

  afterEach(() => jest.restoreAllMocks());

  it('push: Bearer token + X-Line-Retry-Key', async () => {
    fetchMock.mockResolvedValue(reply(200));
    const messages = [{ type: 'text' as const, text: 'hi' }];

    await provider().push('U1', messages, 'retry-uuid');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(LINE_PUSH_URL);
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer line-token',
      'X-Line-Retry-Key': 'retry-uuid',
    });
    expect(JSON.parse(String(init?.body))).toEqual({ to: 'U1', messages });
  });

  it('409 พร้อม retry key = ส่งไปแล้วในครั้งก่อน (สำเร็จ)', async () => {
    fetchMock.mockResolvedValue(reply(409, { message: 'The retry key is already accepted' }));

    await expect(provider().push('U1', [], 'k')).resolves.toBeUndefined();
  });

  it.each([
    [400, false],
    [401, false],
    [403, false],
    [429, true],
    [500, true],
  ])('HTTP %i → retryable=%s', async (status, retryable) => {
    fetchMock.mockResolvedValue(reply(status, { message: 'x' }));

    const error = await provider()
      .push('U1', [], 'k')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DeliveryError);
    expect((error as DeliveryError).retryable).toBe(retryable);
  });

  it('ไม่ได้ตั้ง token → ปิดใช้ และส่งไม่ได้ (ไม่ลองใหม่)', async () => {
    const p = provider(null);

    expect(p.enabled).toBe(false);
    const error = await p.push('U1', [], 'k').catch((e: unknown) => e);
    expect((error as DeliveryError).retryable).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('toFlexMessage', () => {
  it('หัวข้อ + บรรทัด + ปุ่มลิงก์; altText = หัวข้อ', () => {
    const flex = toFlexMessage({
      title: 'จองล็อค A1 สำเร็จ',
      lines: ['วันขาย ส. 21 พ.ย. 2569'],
      link: { label: 'การจองของฉัน', url: 'https://market.test/bookings' },
      sms: '-',
    });

    expect(flex).toMatchObject({ type: 'flex', altText: 'จองล็อค A1 สำเร็จ' });
    const json = JSON.stringify(flex);
    expect(json).toContain('วันขาย ส. 21 พ.ย. 2569');
    expect(json).toContain('"uri":"https://market.test/bookings"');
  });

  it('ไม่มีลิงก์ → ไม่มี footer', () => {
    const flex = toFlexMessage({ title: 't', lines: [], sms: '-' });
    expect(JSON.stringify(flex)).not.toContain('footer');
  });
});

describe('lineSignatureValid', () => {
  const body = Buffer.from('{"events":[]}');
  const sign = (secret: string) => createHmac('sha256', secret).update(body).digest('base64');

  it('ตรงกับ HMAC-SHA256 (base64) ของ body ดิบ', () => {
    expect(lineSignatureValid('s3cret', body, sign('s3cret'))).toBe(true);
    expect(lineSignatureValid('s3cret', body, sign('other'))).toBe(false);
    expect(lineSignatureValid('s3cret', body, 'short')).toBe(false);
  });
});
