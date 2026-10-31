import type { StorageService } from '../storage/storage.service';
import { VendorImageService } from './vendor-image.service';
import { VENDOR_TRANSITIONS } from './vendor-status.service';

describe('vendor state machine (Overview §8.1)', () => {
  it('allows exactly the documented transitions', () => {
    expect(VENDOR_TRANSITIONS).toEqual({
      approve: { from: ['PENDING'], to: 'APPROVED' },
      reject: { from: ['PENDING'], to: 'REJECTED' },
      resubmit: { from: ['REJECTED'], to: 'PENDING' },
      suspend: { from: ['APPROVED'], to: 'SUSPENDED' },
      unsuspend: { from: ['SUSPENDED'], to: 'APPROVED' },
    });
  });
});

describe('VendorImageService key ownership', () => {
  const stat = jest.fn();
  const images = new VendorImageService({ stat } as unknown as StorageService);
  const reg = '0e7a5d3c-1111-4aaa-8bbb-000000000001';
  const vendor = '0e7a5d3c-2222-4aaa-8bbb-000000000002';
  const file = '0e7a5d3c-3333-4aaa-8bbb-000000000003';

  beforeEach(() => stat.mockReset());

  it.each([
    [
      'another registration',
      `vendors/reg-0e7a5d3c-9999-4aaa-8bbb-000000000009/id-card/${file}.png`,
    ],
    ['another vendor', `vendors/0e7a5d3c-9999-4aaa-8bbb-000000000009/id-card/${file}.png`],
    ['the wrong kind', `vendors/reg-${reg}/shop/${file}.png`],
    ['path traversal', `vendors/reg-${reg}/id-card/../../secret.png`],
    ['an unexpected extension', `vendors/reg-${reg}/id-card/${file}.svg`],
  ])('refuses a key of %s without touching storage', async (_name, key) => {
    await expect(
      images.assertUsable([{ registrationId: reg }, { vendorId: vendor }], 'ID_CARD', key),
    ).rejects.toMatchObject({ code: 'UPLOAD_INVALID' });
    expect(stat).not.toHaveBeenCalled();
  });

  it('accepts keys under any of the owner prefixes (then checks storage)', async () => {
    stat.mockResolvedValue(null);

    for (const key of [
      `vendors/reg-${reg}/id-card/${file}.jpg`,
      `vendors/${vendor}/id-card/${file}.webp`,
    ]) {
      await expect(
        images.assertUsable([{ registrationId: reg }, { vendorId: vendor }], 'ID_CARD', key),
      ).rejects.toMatchObject({ message: 'File has not been uploaded' });
    }
    expect(stat).toHaveBeenCalledTimes(2);
  });
});
