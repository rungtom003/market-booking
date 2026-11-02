import type { WaitingRoomStatus } from '@market-booking/shared';
import { formatCountdown, useCountdown } from '../lib/server-clock';
import { Button, Card, Spinner } from './ui';

/** หน้าคิว (รอบเปิดแล้วแต่ยังไม่ได้เข้าหน้าจอง) — แสดงแทนผัง */
export function WaitingRoomPanel({
  status,
  onRejoin,
  rejoining,
  error,
}: {
  status: WaitingRoomStatus | null;
  onRejoin: () => void;
  rejoining: boolean;
  /** เข้าคิวไม่สำเร็จ (เช่น เน็ตหลุด) */
  error: string | null;
}) {
  if (error && !rejoining) {
    return (
      <Card className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-red-800">{error}</p>
        <Button onClick={onRejoin}>ลองเข้าคิวอีกครั้ง</Button>
      </Card>
    );
  }
  if (!status) {
    return (
      <Card>
        <Spinner label="กำลังเข้าคิว…" />
      </Card>
    );
  }
  if (status.state === 'NOT_JOINED') {
    return (
      <Card className="flex flex-col items-center gap-3 text-center">
        <h2 className="text-lg font-semibold text-gray-900">หมดเวลาในหน้าจองแล้ว</h2>
        <p className="text-sm text-gray-700">
          เพื่อให้ทุกคนได้เลือกล็อค แต่ละคนอยู่ในหน้าจองได้ตามเวลาที่ตลาดกำหนด —
          เข้าคิวใหม่เพื่อจองต่อ
        </p>
        <Button onClick={onRejoin} loading={rejoining}>
          เข้าคิวใหม่
        </Button>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col items-center gap-2 text-center" aria-live="polite">
      <h2 className="text-lg font-semibold text-gray-900">กำลังรอเข้าหน้าจอง</h2>
      <p className="text-sm text-gray-700">คนจองพร้อมกันจำนวนมาก ระบบจะพาเข้าหน้าจองตามลำดับคิว</p>
      <p role="status" aria-label="ลำดับคิว" className="text-4xl font-bold text-green-800">
        {status.position ? `ลำดับที่ ${status.position}` : '…'}
      </p>
      <p className="text-sm text-gray-600">รอทั้งหมด {status.waiting.toLocaleString('th-TH')} คน</p>
      <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
        อย่าปิดหรือออกจากหน้านี้ — ถ้าปิดนานเกินครึ่งนาทีจะเสียคิว
      </p>
    </Card>
  );
}

/** ได้เข้าหน้าจองแล้ว — เวลาที่เหลือ */
export function AdmittedBanner({ until, offsetMs }: { until: string; offsetMs: number }) {
  const remaining = useCountdown(until, offsetMs);
  return (
    <p
      role="timer"
      aria-label="เวลาที่เหลือในหน้าจอง"
      className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900"
    >
      ได้เข้าหน้าจองแล้ว — เลือกล็อคภายใน{' '}
      <strong className="font-mono tabular-nums">
        {formatCountdown(remaining).replace(/^00:/, '')}
      </strong>
    </p>
  );
}

/** ก่อนรอบเปิด: อยู่ในคิวแล้ว — ลำดับสุ่มตอนเปิด */
export function PreOpenQueueNote() {
  return (
    <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
      รอบนี้มีคิวเข้าหน้าจอง — คุณเข้าคิวแล้ว
      ทุกคนที่รออยู่ก่อนเวลาเปิดจะได้ลำดับแบบสุ่มเมื่อเปิดจอง (ไม่ต้องรีบกดตอนเปิด
      แต่อย่าปิดหน้านี้)
    </p>
  );
}
