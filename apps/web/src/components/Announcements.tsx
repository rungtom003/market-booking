import { useState } from 'react';
import type { Announcement } from '@market-booking/shared';
import { useAnnouncements } from '../api/announcement';
import { formatThaiDateTime } from '../lib/format';
import { Card } from './ui';

/** ยาวกว่านี้ย่อไว้ก่อน กด "อ่านต่อ" */
const PREVIEW_CHARS = 180;

function AnnouncementItem({ a }: { a: Announcement }) {
  const [open, setOpen] = useState(false);
  const long = a.body.length > PREVIEW_CHARS;
  const body = long && !open ? `${a.body.slice(0, PREVIEW_CHARS).trimEnd()}…` : a.body;
  return (
    <article
      aria-label={a.title}
      className={`flex flex-col gap-1 rounded-lg border p-3 text-sm ${
        a.isPinned ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-gray-900">{a.title}</h3>
        {a.isPinned && (
          <span className="shrink-0 rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-900">
            ปักหมุด
          </span>
        )}
      </div>
      {/* ข้อความจากเจ้าหน้าที่: แสดงตัวอักษรตามที่พิมพ์ (React escape ให้แล้ว) และคงการขึ้นบรรทัด */}
      <p className="whitespace-pre-line break-words text-gray-700">{body}</p>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <time dateTime={a.publishAt}>{formatThaiDateTime(a.publishAt)}</time>
        {long && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="font-semibold text-green-800 underline"
          >
            {open ? 'ย่อ' : 'อ่านต่อ'}
          </button>
        )}
      </div>
    </article>
  );
}

/** ประกาศจากตลาด (Phase 9.3) — ไม่มีประกาศก็ไม่แสดงส่วนนี้ */
export function Announcements() {
  const announcements = useAnnouncements();
  if (!announcements.data?.length) return null;
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="font-semibold text-gray-900">ประกาศจากตลาด</h2>
      <div className="flex flex-col gap-2" role="list" aria-label="ประกาศจากตลาด">
        {announcements.data.map((a) => (
          <div role="listitem" key={a.id}>
            <AnnouncementItem a={a} />
          </div>
        ))}
      </div>
    </Card>
  );
}
