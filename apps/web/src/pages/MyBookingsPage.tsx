import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatIsoDateTh } from '@market-booking/shared';
import type { Booking } from '@market-booking/shared';
import { MY_BOOKINGS_KEY, bookingApi, useMyBookings } from '../api/booking';
import { useCurrentRound } from '../api/market';
import { Layout } from '../components/Layout';
import { Alert, Button, Card, Spinner } from '../components/ui';
import { errorMessage } from '../lib/errors';
import {
  BOOKING_STATUS_STYLE,
  BOOKING_STATUS_TH,
  formatBaht,
  formatThaiDateTime,
} from '../lib/format';
import { formatCountdown, useClockOffset, useCountdown } from '../lib/server-clock';

type Notice = { tone: 'success' | 'error' | 'info'; text: string } | null;

/** การจองของฉัน — วันขายล่าสุดก่อน; ยืนยัน/ยกเลิกได้จากที่นี่ */
export function MyBookingsPage() {
  const bookings = useMyBookings();
  // วัด offset เวลา server ให้ countdown ของ hold (หน้านี้ไม่มี serverTime ของตัวเอง)
  useCurrentRound();
  const [notice, setNotice] = useState<Notice>(null);

  return (
    <Layout title="การจองของฉัน">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {bookings.isPending && <Spinner label="กำลังโหลด…" />}
      {bookings.isError && <Alert>{errorMessage(bookings.error)}</Alert>}
      {bookings.data?.length === 0 && (
        <Card className="text-sm text-gray-600">
          ยังไม่มีการจอง —{' '}
          <Link to="/" className="font-semibold text-green-800 underline">
            เลือกวันขายจากหน้าแรก
          </Link>
        </Card>
      )}
      <ul className="flex flex-col gap-3" aria-label="รายการจอง">
        {bookings.data?.map((b) => (
          <li key={b.id}>
            <BookingCard booking={b} onNotice={setNotice} />
          </li>
        ))}
      </ul>
    </Layout>
  );
}

function BookingCard({
  booking: b,
  onNotice,
}: {
  booking: Booking;
  onNotice: (notice: Notice) => void;
}) {
  const queryClient = useQueryClient();
  const done = (text: string) => {
    onNotice({ tone: 'success', text });
    void queryClient.invalidateQueries({ queryKey: MY_BOOKINGS_KEY });
  };
  const fail = (error: unknown) => onNotice({ tone: 'error', text: errorMessage(error) });

  const confirm = useMutation({
    mutationFn: () => bookingApi.confirm(b.id),
    onSuccess: (r) =>
      done(
        r.status === 'CONFIRMED'
          ? `จองล็อค ${b.stall.code} สำเร็จ`
          : `ยืนยันล็อค ${b.stall.code} แล้ว รอชำระเงิน`,
      ),
    onError: fail,
  });
  const cancel = useMutation({
    mutationFn: () => bookingApi.cancel(b.id),
    onSuccess: () => done(`ยกเลิกการจองล็อค ${b.stall.code} แล้ว`),
    onError: fail,
  });
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const active = ['HOLD', 'PENDING_PAYMENT', 'PENDING_VERIFY', 'CONFIRMED'].includes(b.status);

  return (
    <Card className="flex flex-col gap-2 text-sm text-gray-700">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            ล็อค {b.stall.code} · {b.stall.zoneName}
          </h2>
          <p>
            วัน{formatIsoDateTh(b.marketDay.marketDate, true)} · {b.marketDay.roundName}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${BOOKING_STATUS_STYLE[b.status]}`}
        >
          {BOOKING_STATUS_TH[b.status]}
        </span>
      </div>
      <p>
        ราคา <strong className="text-gray-900">{formatBaht(b.amount)}</strong>
      </p>
      {b.status === 'HOLD' && b.holdExpiresAt && <HoldCountdown until={b.holdExpiresAt} />}
      {b.status === 'PENDING_PAYMENT' && b.paymentDueAt && (
        <p className="text-blue-800">
          ชำระเงินภายใน {formatThaiDateTime(b.paymentDueAt)} (ช่องทางชำระเงินจะเปิดให้ใช้เร็วๆ นี้)
        </p>
      )}
      {b.status === 'CANCELLED' && (
        <p className="text-gray-500">
          {b.cancelledByAdmin ? 'ยกเลิกโดยเจ้าหน้าที่' : 'คุณยกเลิกเอง'}
          {b.cancelReason ? ` — ${b.cancelReason}` : ''}
        </p>
      )}

      {active && (
        <div className="flex flex-col gap-2">
          {b.status === 'HOLD' && (
            <Button onClick={() => confirm.mutate()} loading={confirm.isPending}>
              ยืนยันการจอง
            </Button>
          )}
          {confirmingCancel ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setConfirmingCancel(false)}>
                ไม่ยกเลิก
              </Button>
              <Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending}>
                ยืนยันยกเลิก
              </Button>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmingCancel(true)}>
              ยกเลิกการจอง
            </Button>
          )}
        </div>
      )}
      <Link
        to={`/days/${b.marketDay.id}`}
        className="text-sm font-semibold text-green-800 underline"
      >
        ดูผังวันนี้
      </Link>
    </Card>
  );
}

function HoldCountdown({ until }: { until: string }) {
  const remaining = useCountdown(until, useClockOffset());
  return (
    <p className="text-amber-800">
      กดยืนยันภายใน{' '}
      <span role="timer" className="font-mono font-bold tabular-nums">
        {formatCountdown(remaining).replace(/^00:/, '')}
      </span>
    </p>
  );
}
