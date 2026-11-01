import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { formatBangkokTime, formatIsoDateTh } from '@market-booking/shared';
import QRCode from 'qrcode';
import { useCheckinQr } from '../api/checkin';
import { Layout } from '../components/Layout';
import { Alert, Card, Spinner } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatThaiDateTime } from '../lib/format';
import { useMyBookingUpdates } from '../lib/realtime';

const HOUR = 3_600_000;
/** วันที่เวลาไทยของ ISO — YYYY-MM-DD */
const bangkokDay = (iso: string) => new Date(Date.parse(iso) + 7 * HOUR).toISOString().slice(0, 10);

/** เวลาปิดแบบสั้น: วันเดียวกัน = "HH:MM น.", เที่ยงคืนของวันถัดไป = "24:00 น." */
function closeLabel(openAt: string, closeAt: string): string {
  if (bangkokDay(openAt) === bangkokDay(closeAt)) return `${formatBangkokTime(closeAt)} น.`;
  const midnight = Date.parse(`${bangkokDay(openAt)}T00:00:00+07:00`) + 24 * HOUR;
  return Date.parse(closeAt) === midnight ? '24:00 น.' : formatThaiDateTime(closeAt);
}

/** QR check-in (Overview §9.8) — แสดงให้เจ้าหน้าที่สแกนหน้างาน; สแกนแล้วหน้านี้เปลี่ยนเป็น "เช็คอินแล้ว" เอง */
export function CheckinQrPage() {
  const { bookingId = '' } = useParams();
  const info = useCheckinQr(bookingId);
  useMyBookingUpdates();
  const qr = useQuery({
    queryKey: ['checkin-qr-image', info.data?.token],
    queryFn: () =>
      QRCode.toDataURL(info.data!.token, { width: 320, margin: 2, errorCorrectionLevel: 'M' }),
    enabled: Boolean(info.data?.token),
    staleTime: Infinity,
  });

  const back = (
    <Link to="/bookings" className="font-semibold text-green-800 underline">
      กลับไปการจองของฉัน
    </Link>
  );
  if (info.isPending) {
    return (
      <Layout title="QR เช็คอิน">
        <Spinner label="กำลังโหลด…" />
      </Layout>
    );
  }
  if (info.isError) {
    return (
      <Layout title="QR เช็คอิน">
        <Alert>{errorMessage(info.error)}</Alert>
        {back}
      </Layout>
    );
  }

  const d = info.data;
  return (
    <Layout title="QR เช็คอิน">
      <Card className="flex flex-col items-center gap-3 text-center">
        <div>
          <p className="text-lg font-semibold text-gray-900">
            ล็อค {d.stallCode} · {d.zoneName}
          </p>
          <p className="text-sm text-gray-700">วัน{formatIsoDateTh(d.marketDate, true)}</p>
        </div>
        {d.checkedInAt ? (
          <Alert tone="success" title="เช็คอินแล้ว">
            เมื่อ {formatThaiDateTime(d.checkedInAt)} — ขอให้ขายของให้ดีนะครับ
          </Alert>
        ) : d.noshow ? (
          <Alert tone="warning" title="ไม่ได้เช็คอินภายในเวลา">
            ระบบนับเป็นไม่มาขาย 1 ครั้ง — ติดต่อเจ้าหน้าที่ตลาดถ้าคิดว่าผิดพลาด
          </Alert>
        ) : qr.data ? (
          <>
            <img
              src={qr.data}
              alt={`QR เช็คอิน ล็อค ${d.stallCode}`}
              className="h-72 w-72"
              width={288}
              height={288}
            />
            <p className="text-sm text-gray-700">
              แสดง QR นี้ให้เจ้าหน้าที่สแกนเมื่อมาถึงตลาด (เพิ่มความสว่างหน้าจอจะสแกนง่ายขึ้น)
            </p>
          </>
        ) : (
          <div className="h-72 w-72 animate-pulse rounded-lg bg-gray-100" aria-hidden />
        )}
        <p className="text-sm text-gray-700">
          เช็คอินได้ {formatThaiDateTime(d.openAt)} – {closeLabel(d.openAt, d.closeAt)}
        </p>
        <p className="text-xs text-gray-500">
          ไม่เช็คอินภายในเวลา = นับเป็นไม่มาขาย ครบตามที่ตลาดกำหนดจะถูกระงับสิทธิ์การจองชั่วคราว
        </p>
      </Card>
      {back}
    </Layout>
  );
}
