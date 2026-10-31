import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { Permission } from '@market-booking/shared';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { AuthBootstrap, Protected } from './components/guards';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
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
