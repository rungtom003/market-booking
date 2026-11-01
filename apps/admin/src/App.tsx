import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { Permission } from '@market-booking/shared';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { AuthBootstrap, Protected } from './components/guards';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { BookingsPage } from './pages/BookingsPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { MarketDayPage } from './pages/MarketDayPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { ReportsPage } from './pages/ReportsPage';
import { RoundDetailPage } from './pages/RoundDetailPage';
import { RoundsPage } from './pages/RoundsPage';
import { SettingsPage } from './pages/SettingsPage';
import { StallsPage } from './pages/StallsPage';
import { VendorsPage } from './pages/VendorsPage';
import { ZonesPage } from './pages/ZonesPage';

export function App() {
  return (
    <BrowserRouter>
      <AuthBootstrap>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <Protected>
                <HomePage />
              </Protected>
            }
          />
          <Route
            path="/vendors"
            element={
              <Protected permission={Permission.VENDORS_REVIEW}>
                <VendorsPage />
              </Protected>
            }
          />
          <Route
            path="/bookings"
            element={
              <Protected permission={Permission.BOOKINGS_CANCEL}>
                <BookingsPage />
              </Protected>
            }
          />
          <Route
            path="/payments"
            element={
              <Protected permission={Permission.PAYMENTS_VERIFY}>
                <PaymentsPage />
              </Protected>
            }
          />
          <Route
            path="/reports"
            element={
              <Protected permission={Permission.REPORTS_VIEW}>
                <ReportsPage />
              </Protected>
            }
          />
          <Route
            path="/audit-logs"
            element={
              <Protected permission={Permission.AUDIT_LOG_VIEW}>
                <AuditLogPage />
              </Protected>
            }
          />
          <Route
            path="/rounds"
            element={
              <Protected permission={Permission.ROUNDS_MANAGE}>
                <RoundsPage />
              </Protected>
            }
          />
          <Route
            path="/rounds/:id"
            element={
              <Protected permission={Permission.ROUNDS_MANAGE}>
                <RoundDetailPage />
              </Protected>
            }
          />
          <Route
            path="/rounds/:id/days/:dayId"
            element={
              <Protected permission={Permission.ROUNDS_MANAGE}>
                <MarketDayPage />
              </Protected>
            }
          />
          <Route
            path="/stalls"
            element={
              <Protected permission={Permission.MARKET_LAYOUT_MANAGE}>
                <StallsPage />
              </Protected>
            }
          />
          <Route
            path="/zones"
            element={
              <Protected permission={Permission.MARKET_LAYOUT_MANAGE}>
                <ZonesPage />
              </Protected>
            }
          />
          <Route
            path="/settings"
            element={
              <Protected permission={Permission.SETTINGS_MANAGE}>
                <SettingsPage />
              </Protected>
            }
          />
          <Route
            path="/users"
            element={
              <Protected permission={Permission.ADMIN_USERS_MANAGE}>
                <AdminUsersPage />
              </Protected>
            }
          />
          <Route
            path="*"
            element={
              <Protected>
                <Typography variant="h6" gutterBottom>
                  ไม่พบหน้านี้
                </Typography>
                <Button component={Link} to="/">
                  กลับหน้าหลัก
                </Button>
              </Protected>
            }
          />
        </Routes>
      </AuthBootstrap>
    </BrowserRouter>
  );
}
