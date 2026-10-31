import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatIsoDateTh } from '@market-booking/shared';
import type { Booking, MarketDayStall, MapZone } from '@market-booking/shared';
import { StallMap, StallMapLegend } from '@market-booking/stall-map';
import { MY_BOOKINGS_KEY, bookingApi, useMyBookings } from '../api/booking';
import { type MarketDayStallsData, marketDayKey, useMarketDayStalls } from '../api/market';
import { Layout } from '../components/Layout';
import { Alert, Button, Spinner } from '../components/ui';
import { errorCode, errorMessage } from '../lib/errors';
import { formatBaht, formatThaiDateTime, toMapStatus } from '../lib/format';
import { useMarketDaySocket, useSocketConnected } from '../lib/realtime';
import { formatCountdown, useCountdown } from '../lib/server-clock';

type Notice = { tone: 'error' | 'success' | 'info' | 'warning'; text: string } | null;

/** ล็อคว่างที่ใกล้ที่สุด (วัดจากจุดกึ่งกลาง) — แนะนำเมื่อล็อคที่เลือกถูกจองไปแล้ว */
function nearestAvailable(stalls: MarketDayStall[], from: MarketDayStall, n = 3) {
  const center = (s: MarketDayStall) => [s.posX + s.shapeW / 2, s.posY + s.shapeH / 2] as const;
  const [fx, fy] = center(from);
  return stalls
    .filter((s) => s.id !== from.id && s.status === 'AVAILABLE')
    .map((s) => {
      const [x, y] = center(s);
      return { s, d: Math.hypot(x - fx, y - fy) };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map(({ s }) => s);
}

/** ผังวันขาย + จองล็อค (Overview §9.4) — สถานะล็อคอัปเดตผ่าน socket */
export function DayMapPage() {
  const { marketDayId = '' } = useParams();
  const queryClient = useQueryClient();
  const day = useMarketDayStalls(marketDayId);
  const myBookings = useMyBookings();
  const connected = useSocketConnected();
  useMarketDaySocket(marketDayId);

  const [zoneFilter, setZoneFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [suggested, setSuggested] = useState<MarketDayStall[]>([]);

  const key = marketDayKey(marketDayId);
  const patchStall = (stallId: string, patch: Partial<MarketDayStall>) =>
    queryClient.setQueryData<MarketDayStallsData>(key, (old) =>
      old
        ? { ...old, stalls: old.stalls.map((s) => (s.id === stallId ? { ...s, ...patch } : s)) }
        : old,
    );
  // reference คงที่ — ส่งเข้า effect ของแผง hold (render ทุก 250 ms ตาม countdown)
  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: marketDayKey(marketDayId) });
    void queryClient.invalidateQueries({ queryKey: MY_BOOKINGS_KEY });
  }, [queryClient, marketDayId]);
  const finishHold = useCallback(
    (text: string, tone: NonNullable<Notice>['tone']) => {
      setNotice({ tone, text });
      refreshAll();
    },
    [refreshAll],
  );

  // Optimistic เฉพาะการจอง: ล็อคเป็น "ของฉัน" ทันที แล้วย้อนกลับถ้า error
  const hold = useMutation({
    mutationFn: (stall: MarketDayStall) => bookingApi.hold({ stallId: stall.id, marketDayId }),
    onMutate: async (stall) => {
      setNotice(null);
      setSuggested([]);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<MarketDayStallsData>(key);
      patchStall(stall.id, { status: 'HOLD', mine: true });
      return { previous };
    },
    onError: (error, stall, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous);
      setNotice({ tone: 'error', text: errorMessage(error) });
      if (errorCode(error) === 'STALL_TAKEN') {
        // ผังอาจยังไม่ได้ event — ตั้งให้เห็นว่าไม่ว่างแล้ว แนะนำล็อคใกล้เคียง
        patchStall(stall.id, { status: 'HOLD', mine: false });
        const latest = queryClient.getQueryData<MarketDayStallsData>(key);
        setSuggested(latest ? nearestAvailable(latest.stalls, stall) : []);
      }
      refreshAll();
    },
    onSuccess: (booking) => {
      patchStall(booking.stall.id, { status: 'HOLD', mine: true, bookingId: booking.id });
      queryClient.setQueryData<Booking[]>(MY_BOOKINGS_KEY, (old) => [booking, ...(old ?? [])]);
      setSelectedId(null);
      void queryClient.invalidateQueries({ queryKey: MY_BOOKINGS_KEY });
    },
  });

  const stalls = day.data?.stalls;
  const visible = useMemo(
    () => (stalls ?? []).filter((s) => !zoneFilter || s.zoneId === zoneFilter),
    [stalls, zoneFilter],
  );
  const mapItems = useMemo(() => visible.map((s) => ({ ...s, status: toMapStatus(s) })), [visible]);
  const highlightIds = useMemo(() => new Set(suggested.map((s) => s.id)), [suggested]);

  if (day.isPending) {
    return (
      <Layout title="ผังวันขาย">
        <Spinner label="กำลังโหลดผัง…" />
      </Layout>
    );
  }
  if (day.isError) {
    return (
      <Layout title="ผังวันขาย">
        <Alert>{errorMessage(day.error)}</Alert>
        <Link to="/" className="font-semibold text-green-800 underline">
          กลับหน้าหลัก
        </Link>
      </Layout>
    );
  }

  const data = day.data;
  const zoneById = new Map<string, MapZone>(data.zones.map((z) => [z.id, z]));
  const selected = data.stalls.find((s) => s.id === selectedId) ?? null;
  const activeHold =
    myBookings.data?.find((b) => b.marketDay.id === marketDayId && b.status === 'HOLD') ?? null;

  return (
    <Layout title={`วัน${formatIsoDateTh(data.marketDay.marketDate, true)}`}>
      <RoundStatus data={data} onDue={day.refetch} />
      {!connected && (
        <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          กำลังเชื่อมต่อใหม่… ผังอาจยังไม่อัปเดต
        </p>
      )}
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {suggested.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-600">ล็อคว่างใกล้เคียง:</span>
          {suggested.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedId(s.id)}
              className="rounded-full border border-blue-600 px-3 py-1 font-semibold text-blue-700"
            >
              {s.code}
            </button>
          ))}
        </div>
      )}

      {data.zones.length > 1 && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          โซน
          <select
            value={zoneFilter}
            onChange={(e) => setZoneFilter(e.target.value)}
            className="min-h-10 flex-1 rounded-lg border border-gray-300 bg-white px-2 text-base"
          >
            <option value="">ทุกโซน</option>
            {data.zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <StallMap
        stalls={mapItems}
        zones={data.zones}
        selectedId={selectedId}
        highlightIds={highlightIds}
        onSelect={(s) => setSelectedId(s.id)}
        describe={(s) => `ล็อค ${s.code} ${zoneById.get(s.zoneId)?.name ?? ''}`.trim()}
      />
      <StallMapLegend zones={data.zones} statuses={['HELD', 'BOOKED', 'MINE', 'UNAVAILABLE']} />
      <p className="text-sm text-gray-500">แตะล็อคเพื่อดูรายละเอียดและจอง · ใช้สองนิ้วเพื่อซูม</p>

      {/* เว้นที่ให้แผงด้านล่าง */}
      <div className="h-48" aria-hidden />

      {activeHold ? (
        <HoldBar booking={activeHold} offsetMs={data.clockOffsetMs} onDone={finishHold} />
      ) : (
        selected && (
          <StallSheet
            stall={selected}
            zoneName={zoneById.get(selected.zoneId)?.name ?? '—'}
            canBook={data.round.phase === 'OPEN' && !data.marketDay.isCancelled}
            booking={hold.isPending}
            onBook={() => hold.mutate(selected)}
            onClose={() => setSelectedId(null)}
          />
        )
      )}
    </Layout>
  );
}

/** สถานะรอบ: ยังไม่เปิด (นับถอยหลัง) / เปิดอยู่ / ปิดแล้ว — ถึงเวลาแล้วถาม server ใหม่ */
function RoundStatus({ data, onDue }: { data: MarketDayStallsData; onDue: () => unknown }) {
  const { round } = data;
  const upcoming = round.phase === 'UPCOMING';
  const remaining = useCountdown(upcoming ? round.openAt : round.closeAt, data.clockOffsetMs);
  const due = (upcoming || round.phase === 'OPEN') && remaining === 0;

  useEffect(() => {
    if (!due) return;
    const t = setTimeout(onDue, 500);
    return () => clearTimeout(t);
  }, [due, data.serverTime, onDue]);

  if (data.marketDay.isCancelled) {
    return <Alert tone="warning">วันขายนี้ถูกยกเลิกแล้ว</Alert>;
  }
  if (upcoming) {
    return (
      <div className="rounded-lg bg-blue-50 p-3 text-center text-blue-900">
        <p className="text-sm">ยังไม่เปิดจอง — ดูผังไว้ก่อนได้ เปิดจองในอีก</p>
        <p
          role="timer"
          aria-label="เวลาที่เหลือก่อนเปิดจอง"
          className="font-mono text-2xl font-bold tabular-nums"
        >
          {formatCountdown(remaining)}
        </p>
      </div>
    );
  }
  if (round.phase === 'OPEN') {
    return (
      <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900">
        เปิดจองแล้ว · ปิด {formatThaiDateTime(round.closeAt)} · จองได้สูงสุด{' '}
        {round.maxStallsPerVendor} ล็อค
      </p>
    );
  }
  return <Alert tone="info">ปิดรับจองรอบนี้แล้ว</Alert>;
}

function StallSheet({
  stall,
  zoneName,
  canBook,
  booking,
  onBook,
  onClose,
}: {
  stall: MarketDayStall;
  zoneName: string;
  canBook: boolean;
  booking: boolean;
  onBook: () => void;
  onClose: () => void;
}) {
  const status =
    stall.mine && stall.status !== 'AVAILABLE'
      ? 'ล็อคของคุณ'
      : {
          AVAILABLE: 'ว่าง',
          HOLD: 'มีคนกำลังจอง',
          BOOKED: 'จองแล้ว',
          CLOSED: 'ไม่เปิดจอง',
        }[stall.status];
  const available = stall.status === 'AVAILABLE';

  return (
    <BottomPanel label={`ล็อค ${stall.code}`}>
      <div className="flex items-start justify-between">
        <h2 className="text-lg font-bold text-gray-900">ล็อค {stall.code}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิด"
          className="rounded-md px-2 text-2xl leading-none text-gray-500"
        >
          ×
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-gray-700">
        <dt className="text-gray-500">โซน</dt>
        <dd>{zoneName}</dd>
        <dt className="text-gray-500">ขนาด</dt>
        <dd>
          {stall.widthM} × {stall.lengthM} ม.
        </dd>
        <dt className="text-gray-500">ราคา</dt>
        <dd className="font-semibold text-gray-900">{formatBaht(stall.price)} / วัน</dd>
        <dt className="text-gray-500">สถานะ</dt>
        <dd>{status}</dd>
      </dl>
      {available &&
        (canBook ? (
          <Button onClick={onBook} loading={booking}>
            จองล็อคนี้
          </Button>
        ) : (
          <Button disabled>ยังไม่เปิดจอง</Button>
        ))}
    </BottomPanel>
  );
}

/** หลัง hold: นับถอยหลังเวลายืนยัน + ยืนยัน / ยกเลิก */
function HoldBar({
  booking,
  offsetMs,
  onDone,
}: {
  booking: Booking;
  offsetMs: number;
  onDone: (text: string, tone: 'success' | 'error' | 'info' | 'warning') => void;
}) {
  const remaining = useCountdown(booking.holdExpiresAt ?? booking.createdAt, offsetMs);
  const expired = remaining === 0;
  const code = booking.stall.code;

  const confirm = useMutation({
    mutationFn: () => bookingApi.confirm(booking.id),
    onSuccess: (b) =>
      onDone(
        b.status === 'CONFIRMED'
          ? `จองล็อค ${code} สำเร็จ`
          : `จองล็อค ${code} แล้ว — กรุณาชำระ ${formatBaht(b.amount)} ภายใน ${formatThaiDateTime(b.paymentDueAt ?? '')}`,
        'success',
      ),
    onError: (error) => onDone(errorMessage(error), 'error'),
  });
  const cancel = useMutation({
    mutationFn: () => bookingApi.cancel(booking.id),
    onSuccess: () => onDone(`ยกเลิกการจองล็อค ${code} แล้ว`, 'info'),
    onError: (error) => onDone(errorMessage(error), 'error'),
  });

  // หมดเวลา: แจ้งแล้วโหลดใหม่ (worker เปลี่ยนเป็น EXPIRED และปล่อยล็อค)
  useEffect(() => {
    if (!expired) return;
    const t = setTimeout(
      () => onDone(`หมดเวลายืนยันล็อค ${code} แล้ว ล็อคถูกปล่อยให้คนอื่นจอง`, 'warning'),
      1000,
    );
    return () => clearTimeout(t);
  }, [expired, code, onDone]);

  return (
    <BottomPanel label="ยืนยันการจอง">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">ล็อค {code}</h2>
        <span className="text-sm font-semibold text-gray-900">{formatBaht(booking.amount)}</span>
      </div>
      <p className="text-sm text-gray-700">
        กดยืนยันภายใน{' '}
        <span
          role="timer"
          aria-label="เวลาที่เหลือในการยืนยัน"
          className="font-mono text-lg font-bold tabular-nums text-amber-700"
        >
          {formatCountdown(remaining).replace(/^00:/, '')}
        </span>{' '}
        ไม่งั้นล็อคจะถูกปล่อย
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          onClick={() => cancel.mutate()}
          loading={cancel.isPending}
          disabled={confirm.isPending}
        >
          ยกเลิก
        </Button>
        <Button
          onClick={() => confirm.mutate()}
          loading={confirm.isPending}
          disabled={expired || cancel.isPending}
        >
          ยืนยันการจอง
        </Button>
      </div>
    </BottomPanel>
  );
}

/** แผงติดขอบล่าง (bottom sheet) กว้างเท่าเนื้อหา */
function BottomPanel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.08)]"
    >
      <div className="mx-auto flex max-w-md flex-col gap-3 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {children}
      </div>
    </section>
  );
}
