/** วันที่แบบไทย เวลา Asia/Bangkok (Overview §13) เช่น "7 พ.ย. 2569 14:30" */
export function formatThaiDateTime(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** 0812345678 → 081-234-5678 */
export function formatPhone(phone: string): string {
  return phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
}
