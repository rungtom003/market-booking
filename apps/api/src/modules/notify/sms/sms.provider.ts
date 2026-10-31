/** inject ด้วย `@Inject(SMS_PROVIDER) sms: SmsProvider` */
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsMessage {
  /** เบอร์รูปแบบ 0XXXXXXXXX */
  to: string;
  text: string;
}

/**
 * Adapter ของผู้ให้บริการ SMS (Overview §4) — ผู้ให้บริการจริงยังไม่เลือก (Open Question)
 * implementation ต้องโยน AppException(SERVICE_UNAVAILABLE) เมื่อส่งไม่ได้ และห้าม log ข้อความ (มี OTP)
 */
export interface SmsProvider {
  send(message: SmsMessage): Promise<void>;
}
