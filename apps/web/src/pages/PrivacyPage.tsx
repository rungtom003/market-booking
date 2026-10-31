import { Layout } from '../components/Layout';
import { Alert, Card } from '../components/ui';

/**
 * นโยบายความเป็นส่วนตัว (PDPA) — เนื้อหาร่างเบื้องต้นจากข้อมูลที่ระบบเก็บจริง (Overview §7, §13)
 * เจ้าของตลาดต้องตรวจ/แก้ให้ตรงกับข้อเท็จจริงและให้ฝ่ายกฎหมายรับรองก่อนเปิดใช้งานจริง
 */
export function PrivacyPage() {
  return (
    <Layout title="นโยบายความเป็นส่วนตัว">
      <Alert tone="warning">ฉบับร่าง — รอเจ้าของตลาดตรวจสอบก่อนเปิดใช้งานจริง</Alert>
      <Card className="flex flex-col gap-3 text-sm leading-relaxed text-gray-700">
        <Section title="ข้อมูลที่เราเก็บ">
          ชื่อ นามสกุล ที่อยู่ เบอร์โทรศัพท์ ชื่อร้าน ประเภทสินค้า รูปบัตรประชาชนและรูปร้าน (ถ้าแนบ)
          บัญชี LINE ที่ผูกไว้ ประวัติการจอง การชำระเงิน และการเช็คอิน
        </Section>
        <Section title="วัตถุประสงค์">
          ยืนยันตัวตนผู้ค้า พิจารณาอนุมัติสมาชิก จัดสรรและบริหารการจองล็อค ตรวจสอบการชำระเงิน
          และแจ้งข่าวสารที่เกี่ยวกับการจองทาง LINE หรือ SMS
        </Section>
        <Section title="การเปิดเผยข้อมูล">
          ข้อมูลของคุณเข้าถึงได้เฉพาะเจ้าหน้าที่ตลาดที่ได้รับสิทธิ์
          ผู้ค้ารายอื่นไม่เห็นข้อมูลส่วนตัวของคุณ
          รูปบัตรประชาชนเก็บในพื้นที่ส่วนตัวและเปิดดูได้ผ่านลิงก์ที่หมดอายุภายใน 5 นาที
        </Section>
        <Section title="สิทธิ์ของคุณ">
          ขอดู แก้ไข หรือขอให้ลบข้อมูลส่วนบุคคล และถอนความยินยอมได้ โดยติดต่อเจ้าหน้าที่ตลาด
        </Section>
      </Card>
    </Layout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-semibold text-gray-900">{title}</h2>
      <p>{children}</p>
    </div>
  );
}
