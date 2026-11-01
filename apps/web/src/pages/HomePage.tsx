import { Link } from 'react-router';
import type { VendorProfile } from '@market-booking/shared';
import { useMyProfile } from '../api/vendor';
import { Announcements } from '../components/Announcements';
import { Layout } from '../components/Layout';
import { RoundCard } from '../components/RoundCard';
import { Alert, Button, Card, Spinner, linkButtonClass } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatPhone, formatThaiDateTime } from '../lib/format';

/** หน้าแรกหลัง login — ยังไม่อนุมัติ/ถูกปฏิเสธ/ถูกระงับ แสดงสถานะ; อนุมัติแล้วไปเมนูหลัก */
export function HomePage() {
  const profile = useMyProfile();

  if (profile.isPending) {
    return (
      <Layout>
        <Spinner label="กำลังโหลด…" />
      </Layout>
    );
  }
  if (profile.isError) {
    return (
      <Layout>
        <Alert>{errorMessage(profile.error)}</Alert>
        <Button variant="secondary" onClick={() => void profile.refetch()}>
          ลองใหม่
        </Button>
      </Layout>
    );
  }

  const vendor = profile.data;
  return (
    <Layout>
      <p className="text-gray-600">
        สวัสดี <strong className="text-gray-900">{vendor.firstName}</strong>
      </p>
      <Announcements />
      <StatusCard vendor={vendor} />
      <Card className="text-sm text-gray-700">
        <h2 className="mb-2 font-semibold text-gray-900">ข้อมูลที่ส่งไว้</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-gray-500">ชื่อ</dt>
          <dd>
            {vendor.firstName} {vendor.lastName}
          </dd>
          <dt className="text-gray-500">เบอร์</dt>
          <dd>{formatPhone(vendor.phone)}</dd>
          <dt className="text-gray-500">ร้าน</dt>
          <dd>{vendor.shopName ?? '—'}</dd>
          <dt className="text-gray-500">ประเภท</dt>
          <dd>{vendor.productCategory?.name ?? '—'}</dd>
        </dl>
        <Link to="/profile" className="mt-3 inline-block font-semibold text-green-800 underline">
          แก้ไขข้อมูล
        </Link>
      </Card>
    </Layout>
  );
}

function StatusCard({ vendor }: { vendor: VendorProfile }) {
  switch (vendor.status) {
    case 'PENDING':
      return (
        <Alert tone="warning" title="รอการอนุมัติ">
          เจ้าหน้าที่กำลังตรวจสอบข้อมูลของคุณ เมื่ออนุมัติแล้วจะจองล็อคได้ทันที
        </Alert>
      );
    case 'REJECTED':
      return (
        <div className="flex flex-col gap-3">
          <Alert title="ไม่ผ่านการอนุมัติ">
            {vendor.rejectReason && <p className="mt-1">เหตุผล: {vendor.rejectReason}</p>}
            <p className="mt-1">แก้ไขข้อมูลแล้วส่งให้ตรวจสอบใหม่ได้</p>
          </Alert>
          <Link to="/profile" className={linkButtonClass}>
            แก้ไขข้อมูลและส่งใหม่
          </Link>
        </div>
      );
    case 'SUSPENDED':
      return (
        <Alert title="บัญชีถูกระงับชั่วคราว">
          {vendor.suspendedUntil
            ? `ใช้งานได้อีกครั้งหลัง ${formatThaiDateTime(vendor.suspendedUntil)}`
            : 'กรุณาติดต่อเจ้าหน้าที่ตลาด'}
        </Alert>
      );
    case 'APPROVED':
      return (
        <div className="flex flex-col gap-3">
          <Alert tone="success" title="บัญชีได้รับการอนุมัติแล้ว">
            ดูรอบการจองและผังตลาดได้ด้านล่าง
          </Alert>
          <RoundCard />
          <Link to="/map" className={linkButtonClass}>
            ดูผังตลาด
          </Link>
        </div>
      );
  }
}
