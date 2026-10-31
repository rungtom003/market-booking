import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Spinner } from '../../components/ui';
import { refreshAccessToken } from '../../lib/api-client';
import { session, useSession } from '../../lib/session';

/** เปิดแอป → ลองใช้ refresh cookie ขอ access token (ผู้ใช้ที่ login ค้างไว้ไม่ต้อง login ใหม่) */
export function AuthBootstrap({ children }: { children: ReactNode }) {
  const state = useSession();

  useEffect(() => {
    if (session.get().status === 'loading') void refreshAccessToken();
  }, []);

  if (state.status === 'loading') return <FullPageSpinner />;
  return children;
}

/** หน้าที่ต้อง login — ไม่ได้ login ส่งไปหน้า login แล้วกลับมาหน้าเดิมหลัง login */
export function RequireAuth({ children }: { children: ReactNode }) {
  const state = useSession();
  const location = useLocation();
  if (state.status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

/** หน้า login/สมัคร — login อยู่แล้วไปหน้าแรก */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const state = useSession();
  if (state.status === 'authenticated') return <Navigate to="/" replace />;
  return children;
}

function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner label="กำลังโหลด…" />
    </div>
  );
}
