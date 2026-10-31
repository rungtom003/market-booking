import { useState } from 'react';
import { formatIsoDateTh, weekendDatesOfMonth } from '@market-booking/shared';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

const isoDate = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);

/**
 * ปฏิทินเลือกหลายวัน (วันที่แบบ YYYY-MM-DD ไม่ผูก timezone)
 * วันก่อน `minDate` และวันที่มีในรอบแล้ว (`existing`) เลือกไม่ได้
 */
export function MarketDayCalendar({
  minDate,
  existing,
  selected,
  onChange,
}: {
  minDate: string;
  existing: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [month, setMonth] = useState(() => ({
    year: Number(minDate.slice(0, 4)),
    month: Number(minDate.slice(5, 7)),
  }));
  const shift = (delta: number) =>
    setMonth(({ year, month: m }) => {
      const d = new Date(Date.UTC(year, m - 1 + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
    });

  const selectable = (date: string) => date >= minDate && !existing.has(date);
  const toggle = (date: string) => {
    const next = new Set(selected);
    if (next.has(date)) next.delete(date);
    else next.add(date);
    onChange(next);
  };
  const addWeekends = () =>
    onChange(
      new Set([...selected, ...weekendDatesOfMonth(month.year, month.month).filter(selectable)]),
    );

  const firstDow = new Date(Date.UTC(month.year, month.month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
  const monthTitle = new Date(Date.UTC(month.year, month.month - 1, 1)).toLocaleDateString(
    'th-TH',
    { month: 'long', year: 'numeric', timeZone: 'UTC' },
  );
  const canGoBack = isoDate(month.year, month.month, 1) > minDate.slice(0, 8) + '01';

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <IconButton aria-label="เดือนก่อนหน้า" onClick={() => shift(-1)} disabled={!canGoBack}>
          <ChevronLeftIcon />
        </IconButton>
        <Typography sx={{ fontWeight: 600 }} aria-live="polite">
          {monthTitle}
        </Typography>
        <IconButton aria-label="เดือนถัดไป" onClick={() => shift(1)}>
          <ChevronRightIcon />
        </IconButton>
      </Stack>
      <Box
        role="group"
        aria-label={`ปฏิทิน ${monthTitle}`}
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}
      >
        {WEEKDAYS.map((w, i) => (
          <Typography
            key={w}
            variant="caption"
            aria-hidden
            sx={{
              textAlign: 'center',
              color: i === 0 || i === 6 ? 'error.main' : 'text.secondary',
            }}
          >
            {w}
          </Typography>
        ))}
        {Array.from({ length: firstDow }, (_, i) => (
          <span key={`pad-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = isoDate(month.year, month.month, i + 1);
          const inRound = existing.has(date);
          const isSelected = selected.has(date);
          return (
            <Button
              key={date}
              size="small"
              variant={isSelected ? 'contained' : inRound ? 'outlined' : 'text'}
              color={inRound ? 'success' : 'primary'}
              disabled={!selectable(date)}
              aria-pressed={isSelected}
              aria-label={`${formatIsoDateTh(date, true)}${inRound ? ' (มีในรอบแล้ว)' : ''}`}
              onClick={() => toggle(date)}
              sx={{ minWidth: 0, px: 0 }}
            >
              {i + 1}
            </Button>
          );
        })}
      </Box>
      <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
        <Button size="small" variant="outlined" onClick={addWeekends}>
          เลือกเสาร์-อาทิตย์ทั้งเดือน
        </Button>
        <Button size="small" disabled={selected.size === 0} onClick={() => onChange(new Set())}>
          ล้างที่เลือก
        </Button>
      </Stack>
    </Box>
  );
}
