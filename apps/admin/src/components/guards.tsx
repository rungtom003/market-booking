import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { hasPermission } from '@market-booking/shared';
import type { Permission } from '@market-booking/shared';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { restoreSession } from '../lib/api-client';
import { session, useSession } from '../lib/session';
import { AppLayout } from './AppLayout';
import { ForbiddenPage } from '../pages/ForbiddenPage';

export function AuthBootstrap({ children }: { children: ReactNode }) {
  const state = useSession();
  useEffect(() => {
    if (session.get().status === 'loading') void restoreSession();
  }, []);
  if (state.status === 'loading') {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }
  return children;
}

/** ต้อง login + (ถ้าระบุ) มีสิทธิ์ — ไม่มีสิทธิ์แสดงหน้า 403 ภายใน layout */
export function Protected({
  permission,
  children,
}: {
  permission?: Permission;
  children: ReactNode;
}) {
  const state = useSession();
  const location = useLocation();
  if (state.status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  const allowed = !permission || hasPermission(state.admin.role, permission);
  return <AppLayout>{allowed ? children : <ForbiddenPage />}</AppLayout>;
}
