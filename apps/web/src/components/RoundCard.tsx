import { useEffect } from 'react';
import { formatIsoDateTh } from '@market-booking/shared';
import type { CurrentRound } from '@market-booking/shared';
import { useCurrentRound } from '../api/market';
import { errorMessage } from '../lib/errors';
import { formatThaiDateTime } from '../lib/format';
import { formatCountdown, useCountdown } from '../lib/server-clock';
import { Alert, Card } from './ui';

/** การ์ดรอบการจองบนหน้าแรก: รอบที่กำลังจะเปิด (Countdown ตามเวลา server) หรือที่เปิดอยู่ */
export function RoundCard() {
  const current = useCurrentRound();

  if (current.isPending) return null;
  if (current.isError) return <Alert>{errorMessage(current.error)}</Alert>;
  const { round, clockOffsetMs } = current.data;
  if (!round) {
    return (
      <Card className="text-sm text-gray-600">
        ยังไม่มีรอบการจองที่กำลังจะเปิด — เมื่อตลาดประกาศรอบใหม่จะแสดงที่นี่
      </Card>
    );
  }
  return (
    <RoundDetails
      round={round}
      offsetMs={clockOffsetMs}
      // refetch ของ TanStack Query เป็น reference เดิมทุก render — effect ไม่รีเซ็ต timer ทุก tick
      onDue={current.refetch}
      fetchedAt={current.dataUpdatedAt}
    />
  );
}

function RoundDetails({
  round,
  offsetMs,
  onDue,
  fetchedAt,
}: {
  round: CurrentRound;
  offsetMs: number;
  onDue: () => unknown;
  fetchedAt: number;
}) {
  const open = round.phase === 'OPEN';
  const remaining = useCountdown(open ? round.closeAt : round.openAt, offsetMs);
  const due = remaining === 0;

  // ถึงเวลาแล้ว → ถาม server ว่าเปลี่ยนสถานะหรือยัง (server เป็นผู้ตัดสิน) ถ้ายัง ลองใหม่ทุกวินาที
  useEffect(() => {
    if (!due) return;
    const t = setTimeout(onDue, 1000);
    return () => clearTimeout(t);
  }, [due, fetchedAt, onDue]);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold text-gray-900">{round.name}</h2>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
            open ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
          }`}
        >
          {open ? 'เปิดจองแล้ว' : 'กำลังจะเปิดจอง'}
        </span>
      </div>

      <div className="rounded-lg bg-gray-50 p-3 text-center">
        <p className="text-sm text-gray-600">{open ? 'ปิดจองในอีก' : 'เปิดจองในอีก'}</p>
        <p
          role="timer"
          aria-label={open ? 'เวลาที่เหลือก่อนปิดจอง' : 'เวลาที่เหลือก่อนเปิดจอง'}
          className="font-mono text-3xl font-bold tabular-nums text-gray-900"
        >
          {formatCountdown(remaining)}
        </p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-gray-700">
        <dt className="text-gray-500">เปิดจอง</dt>
        <dd>{formatThaiDateTime(round.openAt)}</dd>
        <dt className="text-gray-500">ปิดจอง</dt>
        <dd>{formatThaiDateTime(round.closeAt)}</dd>
        <dt className="text-gray-500">วันขาย</dt>
        <dd>{round.marketDays.map((d) => formatIsoDateTh(d.marketDate, true)).join(', ')}</dd>
        <dt className="text-gray-500">จองได้</dt>
        <dd>สูงสุด {round.maxStallsPerVendor} ล็อคต่อวัน</dd>
      </dl>
    </Card>
  );
}
