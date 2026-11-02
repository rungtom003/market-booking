import type { AppConfigService } from '../../config/app-config.service';
import { SLIPOK_URL, SlipOkVerifier } from './slipok.verifier';

const config = {
  get: (key: string) => ({ SLIPOK_BRANCH_ID: '12345', SLIPOK_API_KEY: 'SLIPOK-KEY' })[key],
} as unknown as AppConfigService;

const input = {
  paymentId: 'p1',
  slipImageKey: 'vendors/x/slips/y/z.jpg',
  image: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
  contentType: 'image/jpeg',
  amount: 150,
  promptpayId: '0812345678',
};

/** ตัวอย่างคำตอบตามเอกสาร SlipOK (https://slipok.com/api-documentation/request-response-example/) */
const ok = (amount: number) => ({
  success: true,
  data: { success: true, message: '✅', transRef: '010092101507665143', amount },
});
const error = (code: number, message = '-') => ({ code, message });

describe('SlipOkVerifier', () => {
  const verifier = new SlipOkVerifier(config);
  let fetchMock: jest.SpyInstance;

  const reply = (status: number, body: unknown) =>
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  it('ส่งรูป (files) + log + amount ไป branch ด้วย header x-authorization; ถูกต้อง → VALID พร้อม transRef', async () => {
    reply(200, ok(150));
    await expect(verifier.verify(input)).resolves.toEqual({
      status: 'VALID',
      transRef: '010092101507665143',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SLIPOK_URL}/12345`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'x-authorization': 'SLIPOK-KEY' });
    const form = init.body as FormData;
    expect(form.get('log')).toBe('true');
    expect(form.get('amount')).toBe('150');
    const file = form.get('files') as File;
    expect(file.type).toBe('image/jpeg');
    expect(Buffer.from(await file.arrayBuffer()).equals(input.image)).toBe(true);
  });

  it('ยอดบนสลิปไม่ตรง (ตรวจฝั่งเราอีกชั้น) → INVALID AMOUNT_MISMATCH', async () => {
    reply(200, ok(149));
    await expect(verifier.verify(input)).resolves.toMatchObject({
      status: 'INVALID',
      check: 'AMOUNT_MISMATCH',
    });
  });

  it.each([
    [1012, 'INVALID', 'DUPLICATE'],
    [1013, 'INVALID', 'AMOUNT_MISMATCH'],
    [1014, 'INVALID', 'RECEIVER_MISMATCH'],
    [1011, 'INVALID', 'NOT_FOUND'],
    [1007, 'UNVERIFIED', 'UNREADABLE'],
    [1008, 'UNVERIFIED', 'UNREADABLE'],
    [1010, 'UNVERIFIED', 'BANK_DELAY'],
    [1004, 'UNVERIFIED', 'ERROR'],
    [1009, 'UNVERIFIED', 'ERROR'],
  ])('code %i → %s (%s)', async (code, status, check) => {
    reply(code === 1004 ? 401 : 400, error(code));
    await expect(verifier.verify(input)).resolves.toMatchObject({ status, check });
  });

  it('เครือข่ายล้ม / ตอบไม่ใช่ JSON → UNVERIFIED (เจ้าหน้าที่ตรวจ)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(verifier.verify(input)).resolves.toEqual({ status: 'UNVERIFIED', check: 'ERROR' });
    fetchMock.mockResolvedValueOnce(new Response('<html>502</html>', { status: 502 }));
    await expect(verifier.verify(input)).resolves.toEqual({ status: 'UNVERIFIED', check: 'ERROR' });
  });
});
