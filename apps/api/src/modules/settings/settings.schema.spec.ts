import {
  SETTING_DEFAULTS,
  SETTING_KEYS,
  settingsSchema,
  updateSettingsSchema,
} from '@market-booking/shared';

describe('settings schema (Overview §12)', () => {
  it('defaults are valid and match §12', () => {
    expect(settingsSchema.parse(SETTING_DEFAULTS)).toEqual(SETTING_DEFAULTS);
    expect(SETTING_DEFAULTS).toMatchObject({
      registration_mode: 'MANUAL',
      hold_minutes: 10,
      payment_required: true,
      payment_deadline_minutes: 1440,
      promptpay_id: null,
      cancel_before_hours: 48,
    });
    expect(SETTING_KEYS).toHaveLength(16);
  });

  it('accepts a partial update', () => {
    expect(updateSettingsSchema.parse({ registration_mode: 'AUTO', hold_minutes: 15 })).toEqual({
      registration_mode: 'AUTO',
      hold_minutes: 15,
    });
  });

  it.each([
    ['a string for a number', { hold_minutes: '10' }],
    ['a number for a boolean', { payment_required: 1 }],
    ['an unknown enum value', { registration_mode: 'SOMETIMES' }],
    ['a value out of range', { hold_minutes: 0 }],
    ['a non-integer', { noshow_threshold: 2.5 }],
    ['an unknown key', { hold_minutes: 10, not_a_setting: true }],
    ['an empty body', {}],
  ])('rejects %s', (_name, body) => {
    expect(updateSettingsSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ['081-234-5678', '0812345678'],
    ['1 2345 67890 12 3', '1234567890123'],
    ['123456789012345', '123456789012345'],
  ])('normalises PromptPay id %p', (input, expected) => {
    expect(updateSettingsSchema.parse({ promptpay_id: input })).toEqual({ promptpay_id: expected });
  });

  it('rejects malformed PromptPay ids but allows clearing with null', () => {
    expect(updateSettingsSchema.safeParse({ promptpay_id: '12345' }).success).toBe(false);
    expect(updateSettingsSchema.parse({ promptpay_id: null })).toEqual({ promptpay_id: null });
  });

  it('accepts a LINE group id (trimmed) or null', () => {
    const id = `C${'a1'.repeat(16)}`;
    expect(updateSettingsSchema.parse({ line_admin_group_id: ` ${id} ` })).toEqual({
      line_admin_group_id: id,
    });
    expect(updateSettingsSchema.parse({ line_admin_group_id: null })).toEqual({
      line_admin_group_id: null,
    });
    expect(updateSettingsSchema.safeParse({ line_admin_group_id: 'U123' }).success).toBe(false);
  });
});
