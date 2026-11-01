import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { AuthBootstrap, RedirectIfAuthenticated, RequireAuth } from './features/auth/AuthProvider';
import { DayMapPage } from './pages/DayMapPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { MarketMapPage } from './pages/MarketMapPage';
import { MyBookingsPage } from './pages/MyBookingsPage';
import { PaymentPage } from './pages/PaymentPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { ProfilePage } from './pages/ProfilePage';
import { RegisterPage } from './pages/RegisterPage';

export function App() {
  return (
    <BrowserRouter>
      <AuthBootstrap>
        <Routes>
          <Route
            path="/login"
            element={
              <RedirectIfAuthenticated>
                <LoginPage />
              </RedirectIfAuthenticated>
            }
          />
          <Route
            path="/register"
            element={
              <RedirectIfAuthenticated>
                <RegisterPage />
              </RedirectIfAuthenticated>
            }
          />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <HomePage />
              </RequireAuth>
            }
          />
          <Route
            path="/profile"
            element={
              <RequireAuth>
                <ProfilePage />
              </RequireAuth>
            }
          />
          <Route
            path="/map"
            element={
              <RequireAuth>
                <MarketMapPage />
              </RequireAuth>
            }
          />
          <Route
            path="/days/:marketDayId"
            element={
              <RequireAuth>
                <DayMapPage />
              </RequireAuth>
            }
          />
          <Route
            path="/bookings"
            element={
              <RequireAuth>
                <MyBookingsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/bookings/:bookingId/pay"
            element={
              <RequireAuth>
                <PaymentPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthBootstrap>
    </BrowserRouter>
  );
}

function NotFound() {
  return (
    <Layout title="ไม่พบหน้านี้">
      <Link to="/" className="font-semibold text-green-800 underline">
        กลับหน้าหลัก
      </Link>
    </Layout>
  );
}
