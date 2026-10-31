import { thaiMobilePhoneSchema } from '@market-booking/shared';

describe('thaiMobilePhoneSchema', () => {
  it.each([
    ['0812345678', '0812345678'],
    ['081-234-5678', '0812345678'],
    [' 081 234 5678 ', '0812345678'],
    ['+66812345678', '0812345678'],
    ['66912345678', '0912345678'],
    ['0612345678', '0612345678'],
  ])('normalises %p → %p', (input, expected) => {
    expect(thaiMobilePhoneSchema.parse(input)).toBe(expected);
  });

  it.each(['021234567', '0712345678', '081234567', '08123456789', '+1812345678', 'abc', ''])(
    'rejects %p',
    (input) => {
      expect(thaiMobilePhoneSchema.safeParse(input).success).toBe(false);
    },
  );
});
