import { useSyncExternalStore } from 'react';
import { hasPermission } from '@market-booking/shared';
import type { AdminProfile, Permission } from '@market-booking/shared';

/** access token เก็บใน memory เท่านั้น — เปิดแอปใหม่ใช้ refresh cookie ขอใหม่ (AuthBootstrap) */
export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; accessToken: string; admin: AdminProfile };

let state: SessionState = { status: 'loading' };
const listeners = new Set<() => void>();

function set(next: SessionState) {
  state = next;
  listeners.forEach((l) => l());
}

export const session = {
  get: () => state,
  accessToken: () => (state.status === 'authenticated' ? state.accessToken : null),
  signIn: (accessToken: string, admin: AdminProfile) =>
    set({ status: 'authenticated', accessToken, admin }),
  /** refresh ได้ token ใหม่ — โปรไฟล์เดิม */
  setToken: (accessToken: string) => {
    if (state.status === 'authenticated') set({ ...state, accessToken });
  },
  signOut: () => set({ status: 'anonymous' }),
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, session.get);
}

export function useAdmin(): AdminProfile {
  const s = useSession();
  if (s.status !== 'authenticated') throw new Error('useAdmin() outside an authenticated route');
  return s.admin;
}

export function useCan(permission: Permission): boolean {
  return hasPermission(useAdmin().role, permission);
}
