/** inject ด้วย `@Inject(SMS_PROVIDER) sms: SmsProvider` */
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsMessage {
  /** เบอร์รูปแบบ 0XXXXXXXXX */
  to: string;
  text: string;
}

/**
 * Adapter ของผู้ให้บริการ SMS (Overview §4) — เลือกด้วย env `SMS_PROVIDER` (`mock` | `thaibulksms`)
 * ส่งไม่ได้ → โยน `DeliveryError` (SERVICE_UNAVAILABLE + retryable) และห้าม log ข้อความ (มี OTP)
 */
export interface SmsProvider {
  send(message: SmsMessage): Promise<void>;
}
