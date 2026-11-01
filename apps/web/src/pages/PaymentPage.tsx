import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_METHOD_TH, PAYMENT_STATUS_TH, formatIsoDateTh } from '@market-booking/shared';
import type { BookingPaymentInfo } from '@market-booking/shared';
import QRCode from 'qrcode';
import { MY_BOOKINGS_KEY, useMyBookings } from '../api/booking';
import { paymentApi, paymentKey, useBookingPayment } from '../api/payment';
import { ImageUpload } from '../components/ImageUpload';
import { Layout } from '../components/Layout';
import { Alert, Button, Card, Spinner } from '../components/ui';
import { errorCode, errorMessage } from '../lib/errors';
import { formatBaht, formatPhone, formatThaiDateTime } from '../lib/format';
import { useMyBookingUpdates } from '../lib/realtime';
import { formatCountdown, useClockOffset, useCountdown } from '../lib/server-clock';

/** เบอร์ 10 หลักแสดงแบบมีขีด; เลขผู้เสียภาษี/e-Wallet แสดงตามเดิม */
const formatPromptPayId = (id: string) => (id.length === 10 ? formatPhone(id) : id);

/** หน้าชำระเงิน (Overview §9.5): QR พร้อมเพย์ตามยอด + เวลาที่เหลือ + อัปโหลดสลิป + ประวัติ */
export function PaymentPage() {
  const { bookingId = '' } = useParams();
  const info = useBookingPayment(bookingId);
  const bookings = useMyBookings();
  useMyBookingUpdates();
  const booking = bookings.data?.find((b) => b.id === bookingId);

  if (info.isPending) {
    return (
      <Layout title="ชำระเงิน">
        <Spinner label="กำลังโหลด…" />
      </Layout>
    );
  }
  if (info.isError) {
    return (
      <Layout title="ชำระเงิน">
        <Alert>{errorMessage(info.error)}</Alert>
        <Link to="/bookings" className="font-semibold text-green-800 underline">
          กลับไปการจองของฉัน
        </Link>
      </Layout>
    );
  }

  const data = info.data;
  const lastPayment = data.payments[0];
  return (
    <Layout title="ชำระเงิน">
      <Card className="flex items-start justify-between gap-3 text-sm text-gray-700">
        <div>
          {booking && (
            <>
              <p className="text-base font-semibold text-gray-900">
                ล็อค {booking.stall.code} · {booking.stall.zoneName}
              </p>
              <p>
                วัน{formatIsoDateTh(booking.marketDay.marketDate, true)} ·{' '}
                {booking.marketDay.roundName}
              </p>
            </>
          )}
        </div>
        <p className="shrink-0 text-right">
          <span className="block text-xs text-gray-500">ยอดชำระ</span>
          <strong className="text-xl text-gray-900">{formatBaht(data.amount)}</strong>
        </p>
      </Card>

      {data.bookingStatus === 'PENDING_PAYMENT' && (
        <>
          {lastPayment?.status === 'REJECTED' && (
            <Alert tone="warning" title="สลิปก่อนหน้าไม่ผ่านการตรวจ">
              {lastPayment.rejectReason && <p>เหตุผล: {lastPayment.rejectReason}</p>}
              <p>กรุณาโอนให้ถูกต้องแล้วส่งสลิปใหม่</p>
            </Alert>
          )}
          {data.paymentDueAt && (
            // refetch เป็น reference เดิมทุก render — timer ใน PaymentDeadline ไม่ถูกรีเซ็ต
            <PaymentDeadline dueAt={data.paymentDueAt} onDue={info.refetch} />
          )}
          {data.promptpay ? (
            <PromptPayQr
              payload={data.promptpay.payload}
              promptpayId={data.promptpay.id}
              amount={data.amount}
              fileName={`promptpay-${booking?.stall.code ?? bookingId.slice(0, 8)}.png`}
            />
          ) : (
            <Alert tone="info" title="ยังไม่เปิดรับโอนผ่านพร้อมเพย์">
              กรุณาชำระเงินสดกับเจ้าหน้าที่ตลาดภายในเวลาที่กำหนด
            </Alert>
          )}
          {data.promptpay && <SlipForm bookingId={bookingId} />}
        </>
      )}
      {data.bookingStatus === 'PENDING_VERIFY' && (
        <Alert tone="info" title="ส่งสลิปแล้ว รอเจ้าหน้าที่ตรวจ">
          ระหว่างรอตรวจการจองจะไม่หมดเวลา — ผลการตรวจจะแสดงที่นี่ทันที
        </Alert>
      )}
      {data.bookingStatus === 'CONFIRMED' && (
        <Alert tone="success" title="ชำระเงินเรียบร้อย">
          การจองของคุณยืนยันแล้ว
        </Alert>
      )}
      {data.bookingStatus === 'EXPIRED' && (
        <Alert title="หมดเวลาชำระเงิน">การจองนี้หมดอายุแล้ว ล็อคถูกปล่อยให้คนอื่นจอง</Alert>
      )}
      {data.bookingStatus === 'CANCELLED' && <Alert title="การจองนี้ถูกยกเลิกแล้ว" />}
      {data.bookingStatus === 'HOLD' && (
        <Alert tone="warning">ยังไม่ได้ยืนยันการจอง — ยืนยันที่หน้า "การจองของฉัน" ก่อน</Alert>
      )}

      {data.payments.length > 0 && <PaymentHistory payments={data.payments} />}
      <Link to="/bookings" className="text-sm font-semibold text-green-800 underline">
        กลับไปการจองของฉัน
      </Link>
    </Layout>
  );
}

/** เวลาที่เหลือก่อนหมดกำหนดชำระ (เวลา server) — ถึงเวลาแล้วโหลดสถานะใหม่ */
function PaymentDeadline({ dueAt, onDue }: { dueAt: string; onDue: () => unknown }) {
  const remaining = useCountdown(dueAt, useClockOffset());
  const due = remaining === 0;
  useEffect(() => {
    if (!due) return;
    const t = setTimeout(onDue, 1000);
    return () => clearTimeout(t);
  }, [due, onDue]);

  return (
    <div className="rounded-lg bg-amber-50 p-3 text-center text-amber-900">
      <p className="text-sm">ชำระภายใน {formatThaiDateTime(dueAt)} — เหลือเวลา</p>
      <p
        role="timer"
        aria-label="เวลาที่เหลือในการชำระเงิน"
        className="font-mono text-2xl font-bold tabular-nums"
      >
        {formatCountdown(remaining)}
      </p>
    </div>
  );
}

function PromptPayQr({
  payload,
  promptpayId,
  amount,
  fileName,
}: {
  payload: string;
  promptpayId: string;
  amount: number;
  fileName: string;
}) {
  // ภาพ QR (PNG) จาก payload — ใช้ทั้งแสดงและบันทึกรูป
  const qr = useQuery({
    queryKey: ['promptpay-qr', payload],
    queryFn: () => QRCode.toDataURL(payload, { width: 320, margin: 2, errorCorrectionLevel: 'M' }),
    staleTime: Infinity,
  });

  return (
    <Card className="flex flex-col items-center gap-3 text-center">
      <h2 className="font-semibold text-gray-900">สแกนจ่ายผ่านพร้อมเพย์</h2>
      {qr.data ? (
        <img
          src={qr.data}
          alt={`QR พร้อมเพย์ ยอด ${formatBaht(amount)}`}
          className="h-64 w-64"
          width={256}
          height={256}
        />
      ) : (
        <div className="h-64 w-64 animate-pulse rounded-lg bg-gray-100" aria-hidden />
      )}
      <p className="text-sm text-gray-700">
        พร้อมเพย์ {formatPromptPayId(promptpayId)} · ยอด <strong>{formatBaht(amount)}</strong>
      </p>
      {qr.data && (
        <a
          href={qr.data}
          download={fileName}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-green-700 px-4 text-base font-semibold text-green-800 hover:bg-green-50"
        >
          บันทึกรูป QR
        </a>
      )}
      <p className="text-xs text-gray-500">
        บันทึกรูปแล้วเปิดในแอปธนาคารเพื่อสแกน (บน iPhone กดค้างที่รูปแล้วเลือกบันทึก)
      </p>
    </Card>
  );
}

function SlipForm({ bookingId }: { bookingId: string }) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // เปลี่ยน key ของ ImageUpload เพื่อล้างรูปเดิมหลังส่ง/ส่งไม่ผ่าน
  const [attempt, setAttempt] = useState(0);

  const submit = useMutation({
    mutationFn: (slipKey: string) => paymentApi.submit(bookingId, slipKey),
    onSuccess: (data: BookingPaymentInfo) => {
      queryClient.setQueryData(paymentKey(bookingId), data);
      void queryClient.invalidateQueries({ queryKey: MY_BOOKINGS_KEY });
    },
    onError: (e) => {
      setError(errorMessage(e));
      setKey(null);
      setAttempt((n) => n + 1);
      if (['PAYMENT_DUE_PASSED', 'INVALID_STATE_TRANSITION'].includes(errorCode(e))) {
        void queryClient.invalidateQueries({ queryKey: paymentKey(bookingId) });
      }
    },
  });

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-semibold text-gray-900">ส่งสลิปการโอน</h2>
      <ImageUpload
        key={attempt}
        label="รูปสลิป"
        required
        requestUpload={(file) => paymentApi.slipUpload(bookingId, file)}
        onBusyChange={setUploading}
        onUploaded={(k) => {
          setError(null);
          setKey(k);
        }}
      />
      {error && <Alert>{error}</Alert>}
      <Button
        disabled={!key || uploading}
        loading={submit.isPending}
        onClick={() => key && submit.mutate(key)}
      >
        ส่งสลิป
      </Button>
    </Card>
  );
}

function PaymentHistory({ payments }: { payments: BookingPaymentInfo['payments'] }) {
  return (
    <Card className="text-sm text-gray-700">
      <h2 className="mb-2 font-semibold text-gray-900">ประวัติการชำระ</h2>
      <ul className="flex flex-col divide-y divide-gray-100" aria-label="ประวัติการชำระ">
        {payments.map((p) => (
          <li key={p.id} className="flex flex-col gap-0.5 py-2">
            <div className="flex justify-between gap-2">
              <span>
                {PAYMENT_METHOD_TH[p.method]} · {formatBaht(p.amount)}
              </span>
              <span
                className={`font-semibold ${
                  p.status === 'APPROVED'
                    ? 'text-green-700'
                    : p.status === 'REJECTED'
                      ? 'text-red-700'
                      : 'text-blue-700'
                }`}
              >
                {PAYMENT_STATUS_TH[p.status]}
              </span>
            </div>
            <span className="text-xs text-gray-500">
              ส่งเมื่อ {formatThaiDateTime(p.createdAt)}
            </span>
            {p.rejectReason && (
              <span className="text-xs text-red-700">เหตุผล: {p.rejectReason}</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
