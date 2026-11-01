import { formatIsoDateTh } from '@market-booking/shared';

/**
 * ข้อความแจ้งเตือนทุกแบบ (Phase 7) — params เก็บใน notification_logs.payload แล้วค่อยแปลงเป็นข้อความตอนส่ง
 * เวลาเก็บเป็น ISO (UTC) แสดงเป็นเวลาไทย; วันขายเป็น `YYYY-MM-DD`
 */
export type NotificationTemplate =
  | { template: 'vendor.approved'; params: Record<string, never> }
  | { template: 'vendor.rejected'; params: { reason: string | null } }
  | { template: 'vendor.suspended'; params: { reason: string | null; until: string | null } }
  | { template: 'round.opening_soon'; params: { roundName: string; openAt: string } }
  | { template: 'booking.confirmed'; params: { stallCode: string; marketDate: string } }
  | {
      template: 'payment.due_soon';
      params: {
        bookingId: string;
        stallCode: string;
        marketDate: string;
        amount: number;
        dueAt: string;
      };
    }
  | {
      template: 'payment.rejected';
      params: { bookingId: string; stallCode: string; reason: string | null; dueAt: string | null };
    }
  | {
      template: 'booking.cancelled';
      params: { stallCode: string; marketDate: string; reason: string | null };
    }
  | {
      template: 'waitlist.offer';
      params: { stallCode: string; marketDate: string; expiresAt: string };
    }
  | { template: 'admin.vendor_registered'; params: { vendorName: string } }
  | {
      template: 'admin.payment_submitted';
      params: { vendorName: string; stallCode: string; marketDate: string; amount: number };
    };

export type TemplateName = NotificationTemplate['template'];

/** ข้อความกลางที่แต่ละช่องทางแปลงเอง (LINE = Flex, SMS = `sms` สั้นๆ ประหยัดเครดิต) */
export interface RenderedMessage {
  title: string;
  lines: string[];
  link?: { label: string; url: string };
  /** SMS ภาษาไทย 70 ตัวอักษรต่อข้อความ — ใส่เฉพาะที่จำเป็น + ลิงก์ */
  sms: string;
}

export interface RenderContext {
  webOrigin: string;
  adminOrigin: string;
}

const baht = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });

/** "7 พ.ย. 2569 14:30" (เวลาไทย) */
export function formatDateTimeTh(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

const reasonLine = (reason: string | null): string[] => (reason ? [`เหตุผล: ${reason}`] : []);

export function renderTemplate(n: NotificationTemplate, ctx: RenderContext): RenderedMessage {
  const web = (path: string) => `${ctx.webOrigin}${path}`;
  const admin = (path: string) => `${ctx.adminOrigin}${path}`;

  switch (n.template) {
    case 'vendor.approved':
      return {
        title: 'บัญชีผู้ค้าได้รับการอนุมัติแล้ว',
        lines: ['จองล็อคได้เมื่อรอบการจองเปิด'],
        link: { label: 'ดูรอบการจอง', url: web('/') },
        sms: `บัญชีผู้ค้าได้รับการอนุมัติแล้ว จองล็อคได้ที่ ${web('/')}`,
      };
    case 'vendor.rejected':
      return {
        title: 'ใบสมัครผู้ค้ายังไม่ผ่านการอนุมัติ',
        lines: [...reasonLine(n.params.reason), 'แก้ไขข้อมูลแล้วส่งใหม่ได้'],
        link: { label: 'แก้ไขข้อมูล', url: web('/profile') },
        sms: `ใบสมัครผู้ค้ายังไม่ผ่าน แก้ไขแล้วส่งใหม่ได้ที่ ${web('/profile')}`,
      };
    case 'vendor.suspended': {
      const until = n.params.until ? `ถึง ${formatDateTimeTh(n.params.until)}` : 'จนกว่าจะปลดระงับ';
      return {
        title: 'บัญชีผู้ค้าถูกระงับสิทธิ์การจอง',
        lines: [...reasonLine(n.params.reason), `ระงับ${until}`],
        link: { label: 'ดูรายละเอียด', url: web('/profile') },
        sms: `บัญชีผู้ค้าถูกระงับสิทธิ์การจอง${until} ดูที่ ${web('/profile')}`,
      };
    }
    case 'round.opening_soon': {
      const at = formatDateTimeTh(n.params.openAt);
      return {
        title: `รอบจอง "${n.params.roundName}" ใกล้เปิดแล้ว`,
        lines: [`เปิดจอง ${at} น.`, 'เตรียมเลือกล็อคที่ต้องการไว้ก่อนได้'],
        link: { label: 'ดูผังตลาด', url: web('/') },
        sms: `รอบจองเปิด ${at} น. ${web('/')}`,
      };
    }
    case 'booking.confirmed': {
      const date = formatIsoDateTh(n.params.marketDate, true);
      return {
        title: `จองล็อค ${n.params.stallCode} สำเร็จ`,
        lines: [`วันขาย ${date}`],
        link: { label: 'การจองของฉัน', url: web('/bookings') },
        sms: `จองล็อค ${n.params.stallCode} วันที่ ${date} สำเร็จ`,
      };
    }
    case 'payment.due_soon': {
      const due = formatDateTimeTh(n.params.dueAt);
      const pay = web(`/bookings/${n.params.bookingId}/pay`);
      return {
        title: `ใกล้หมดเวลาชำระค่าล็อค ${n.params.stallCode}`,
        lines: [
          `วันขาย ${formatIsoDateTh(n.params.marketDate, true)}`,
          `ยอด ${baht.format(n.params.amount)} บาท`,
          `ชำระภายใน ${due} น. ไม่เช่นนั้นการจองจะถูกยกเลิก`,
        ],
        link: { label: 'ชำระเงิน', url: pay },
        sms: `ชำระค่าล็อค ${n.params.stallCode} ภายใน ${due} น. ${pay}`,
      };
    }
    case 'payment.rejected': {
      const pay = web(`/bookings/${n.params.bookingId}/pay`);
      const due = n.params.dueAt ? [`ส่งสลิปใหม่ภายใน ${formatDateTimeTh(n.params.dueAt)} น.`] : [];
      return {
        title: `สลิปค่าล็อค ${n.params.stallCode} ไม่ผ่านการตรวจ`,
        lines: [...reasonLine(n.params.reason), ...due],
        link: { label: 'ส่งสลิปใหม่', url: pay },
        sms: `สลิปค่าล็อค ${n.params.stallCode} ไม่ผ่าน ส่งใหม่ที่ ${pay}`,
      };
    }
    case 'booking.cancelled': {
      const date = formatIsoDateTh(n.params.marketDate, true);
      return {
        title: `การจองล็อค ${n.params.stallCode} ถูกยกเลิก`,
        lines: [`วันขาย ${date}`, ...reasonLine(n.params.reason)],
        link: { label: 'การจองของฉัน', url: web('/bookings') },
        sms: `การจองล็อค ${n.params.stallCode} วันที่ ${date} ถูกยกเลิกโดยเจ้าหน้าที่`,
      };
    }
    case 'waitlist.offer': {
      const until = formatDateTimeTh(n.params.expiresAt);
      return {
        title: `ได้สิทธิ์ล็อค ${n.params.stallCode} จากคิวรอ`,
        lines: [
          `วันขาย ${formatIsoDateTh(n.params.marketDate, true)}`,
          `ยืนยันภายใน ${until} น. ไม่เช่นนั้นสิทธิ์จะส่งต่อคิวถัดไป`,
        ],
        link: { label: 'ยืนยันการจอง', url: web('/bookings') },
        sms: `ได้สิทธิ์ล็อค ${n.params.stallCode} ยืนยันภายใน ${until} น. ${web('/bookings')}`,
      };
    }
    case 'admin.vendor_registered':
      return {
        title: 'มีผู้ค้าสมัครใหม่ รอตรวจ',
        lines: [n.params.vendorName],
        link: { label: 'ตรวจผู้ค้า', url: admin('/vendors') },
        sms: `ผู้ค้าสมัครใหม่: ${n.params.vendorName}`,
      };
    case 'admin.payment_submitted':
      return {
        title: 'มีสลิปใหม่รอตรวจ',
        lines: [
          `${n.params.vendorName} · ล็อค ${n.params.stallCode}`,
          `วันขาย ${formatIsoDateTh(n.params.marketDate, true)}`,
          `ยอด ${baht.format(n.params.amount)} บาท`,
        ],
        link: { label: 'ตรวจสลิป', url: admin('/payments') },
        sms: `สลิปใหม่: ${n.params.vendorName} ล็อค ${n.params.stallCode}`,
      };
  }
}
