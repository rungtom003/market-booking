import { useSyncExternalStore } from 'react';

/**
 * สถานะการ login — access token เก็บใน memory เท่านั้น (ไม่ลง localStorage กัน XSS ขโมย)
 * เปิดแอปใหม่/รีเฟรชหน้า → ใช้ refresh cookie (httpOnly) ขอ token ใหม่ (AuthProvider)
 */
export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; accessToken: string };

let state: SessionState = { status: 'loading' };
/** ข้อความแจ้งครั้งเดียวที่หน้า login (เช่น ลบบัญชีแล้ว) — redirect ของ RequireAuth ทับ location.state */
let flash: string | null = null;
const listeners = new Set<() => void>();

function set(next: SessionState) {
  state = next;
  listeners.forEach((l) => l());
}

export const session = {
  get: () => state,
  accessToken: () => (state.status === 'authenticated' ? state.accessToken : null),
  signIn: (accessToken: string) => set({ status: 'authenticated', accessToken }),
  signOut: (notice?: string) => {
    flash = notice ?? null;
    set({ status: 'anonymous' });
  },
  flash: () => flash,
  clearFlash: () => {
    flash = null;
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, session.get);
}
