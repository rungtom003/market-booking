import { useSyncExternalStore } from 'react';

/**
 * นาฬิกาที่เดินทุก 250 ms ใช้ร่วมกันทุก component (timer เดียว)
 * Countdown ใช้ `useNow() + offset จากเวลา server` — ไม่ขึ้นกับนาฬิกาเครื่องที่อาจตั้งผิด
 */
const TICK_MS = 250;
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const getSnapshot = () => now;

/** เวลาเครื่อง (ms) อัปเดตทุก 250 ms */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** เวลาที่เหลือ (ms, ไม่ติดลบ) ถึง `targetIso` ตามเวลา server = เวลาเครื่อง + `offsetMs` */
export function useCountdown(targetIso: string, offsetMs: number): number {
  return Math.max(0, Date.parse(targetIso) - (useNow() + offsetMs));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 93_784_000 → "1 วัน 02:03:04", 3_000 → "00:00:03" (ปัดเศษวินาทีขึ้น — ถึง 0 พอดีตอนเปิด) */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const days = Math.floor(total / 86_400);
  const hms = `${pad(Math.floor((total % 86_400) / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return days > 0 ? `${days} วัน ${hms}` : hms;
}

// ───────────── offset ล่าสุดของทั้งแอป ─────────────

let offsetMs = 0;
const offsetListeners = new Set<() => void>();

/** เก็บ offset (เวลา server − เวลาเครื่อง) ที่วัดได้ล่าสุด — query ที่มี `serverTime` เรียกหลังโหลด */
export function setClockOffset(ms: number): void {
  if (ms === offsetMs) return;
  offsetMs = ms;
  offsetListeners.forEach((l) => l());
}

function subscribeOffset(listener: () => void) {
  offsetListeners.add(listener);
  return () => {
    offsetListeners.delete(listener);
  };
}

/** offset ล่าสุด (0 ถ้ายังไม่เคยวัด) — ใช้กับ `useCountdown` ในหน้าที่ไม่มี `serverTime` ของตัวเอง */
export function useClockOffset(): number {
  return useSyncExternalStore(subscribeOffset, () => offsetMs);
}
