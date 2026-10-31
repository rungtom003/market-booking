import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '../api/auth';
import { useSession } from '../lib/session';

/** โครงหน้าแบบ mobile-first: แถบหัว + เนื้อหากว้างไม่เกิน 28rem (พอดีมือถือ ใช้ได้บนจอใหญ่) */
export function Layout({ title, children }: { title?: string; children: ReactNode }) {
  const state = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await authApi.logout();
    } finally {
      queryClient.clear();
      navigate('/login', { replace: true });
    }
  }

  return (
    <div className="min-h-dvh bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
          <Link to="/" className="text-lg font-bold text-green-800">
            จองล็อคตลาด
          </Link>
          {state.status === 'authenticated' && (
            <nav className="flex items-center gap-1 text-sm">
              <Link to="/bookings" className="rounded-md px-2 py-2 text-gray-700 hover:bg-gray-100">
                การจอง
              </Link>
              <Link to="/profile" className="rounded-md px-2 py-2 text-gray-700 hover:bg-gray-100">
                โปรไฟล์
              </Link>
              <button
                type="button"
                onClick={logout}
                disabled={loggingOut}
                className="rounded-md px-2 py-2 text-gray-700 hover:bg-gray-100"
              >
                ออกจากระบบ
              </button>
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
        {title && <h1 className="text-xl font-bold text-gray-900">{title}</h1>}
        {children}
      </main>
    </div>
  );
}
