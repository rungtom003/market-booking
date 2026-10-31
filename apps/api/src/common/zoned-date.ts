const formatters = new Map<string, Intl.DateTimeFormat>();

function partsIn(at: Date, timeZone: string) {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** ส่วนต่างเวลาท้องถิ่น − UTC (ms) ของ `timeZone` ณ เวลา `at` */
function offsetMs(at: Date, timeZone: string): number {
  const p = partsIn(at, timeZone);
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return localAsUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** เวลาเริ่มวัน (00:00 ท้องถิ่น) ของวันที่ `YYYY-MM-DD` ใน `timeZone` เช่น ตลาด Asia/Bangkok */
export function zonedDayStart(date: string, timeZone: string): Date {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  const guess = new Date(utcMidnight - offsetMs(new Date(utcMidnight), timeZone));
  // วันที่เปลี่ยนเวลา (DST) offset ตอนเที่ยงคืนอาจต่างจากที่เดา — คำนวณซ้ำอีกรอบ
  return new Date(utcMidnight - offsetMs(guess, timeZone));
}

/** วันที่ปัจจุบัน `YYYY-MM-DD` ใน `timeZone` */
export function zonedDate(at: Date, timeZone: string): string {
  const p = partsIn(at, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
