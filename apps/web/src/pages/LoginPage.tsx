import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { OTP_LENGTH, otpRequestSchema } from '@market-booking/shared';
import type { OtpRequestInput, VendorAuthResult } from '@market-booking/shared';
import { z } from 'zod';
import { authApi } from '../api/auth';
import { Layout } from '../components/Layout';
import { Alert, Button, Card, TextField } from '../components/ui';
import { lineIdTokenAfterRedirect, lineLoginEnabled, startLineLogin } from '../features/auth/line';
import { errorMessage, toApiError } from '../lib/errors';
import { formatPhone } from '../lib/format';
import { registrationDraft } from '../lib/registration-draft';
import { session } from '../lib/session';

const otpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'กรอกรหัส 6 หลักที่ได้รับทาง SMS'),
});

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  // มาจากหน้าสมัครทาง LINE: ยืนยันเบอร์เดิมแล้วผูก LINE เข้าบัญชีเก่า
  const linkLine = params.get('link') === 'line';

  const [phone, setPhone] = useState<string | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);

  function handleResult(result: VendorAuthResult) {
    if (result.status === 'LOGGED_IN') {
      registrationDraft.clear();
      session.signIn(result.accessToken);
      navigate(from, { replace: true });
    } else {
      registrationDraft.save(result);
      navigate('/register', { replace: true });
    }
  }

  // กลับมาจากหน้า login ของ LINE
  useEffect(() => {
    if (!lineLoginEnabled) return;
    lineIdTokenAfterRedirect()
      .then((idToken) => (idToken ? authApi.loginWithLine(idToken).then(handleResult) : null))
      .catch((e: unknown) => setLineError(errorMessage(e)));
    // ทำครั้งเดียวตอนเปิดหน้า
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loginWithLine() {
    setLineError(null);
    try {
      const idToken = await startLineLogin();
      if (idToken) handleResult(await authApi.loginWithLine(idToken));
    } catch (e) {
      setLineError(errorMessage(e));
    }
  }

  return (
    <Layout title="เข้าสู่ระบบ / สมัครสมาชิก">
      {linkLine && (
        <Alert tone="info">
          ยืนยันเบอร์โทรที่เคยสมัครไว้ เพื่อเชื่อมบัญชี LINE เข้ากับบัญชีเดิม
        </Alert>
      )}
      <Card>
        {phone ? (
          <OtpStep
            phone={phone}
            linkLine={linkLine}
            onBack={() => setPhone(null)}
            onResult={handleResult}
          />
        ) : (
          <PhoneStep onSent={setPhone} />
        )}
      </Card>

      {lineLoginEnabled && !phone && !linkLine && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 text-sm text-gray-400">
            <span className="h-px flex-1 bg-gray-200" /> หรือ{' '}
            <span className="h-px flex-1 bg-gray-200" />
          </div>
          <Button
            type="button"
            className="bg-[#06C755] text-white hover:bg-[#05b14c]"
            onClick={() => void loginWithLine()}
          >
            เข้าสู่ระบบด้วย LINE
          </Button>
          {lineError && <Alert>{lineError}</Alert>}
        </div>
      )}

      <p className="text-center text-sm text-gray-500">
        ผู้ค้าใหม่ยืนยันเบอร์โทรแล้วระบบจะพาไปหน้าสมัครสมาชิก ·{' '}
        <Link to="/privacy" className="text-green-800 underline">
          นโยบายความเป็นส่วนตัว
        </Link>
      </p>
    </Layout>
  );
}

function PhoneStep({ onSent }: { onSent: (phone: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<OtpRequestInput>({ resolver: zodResolver(otpRequestSchema) });

  const submit = form.handleSubmit(async ({ phone }) => {
    setError(null);
    try {
      await authApi.requestOtp(phone);
      onSent(phone);
    } catch (e) {
      // ยังติด cooldown 60 วินาทีจากครั้งก่อน = รหัสเดิมยังใช้ได้ → ไปหน้ากรอกรหัสเลย
      const wait = retryAfter(e);
      if (wait !== null && wait <= 60) {
        onSent(phone);
        return;
      }
      setError(errorMessage(e));
    }
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <TextField
        label="เบอร์มือถือ"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="08x-xxx-xxxx"
        required
        error={form.formState.errors.phone?.message}
        {...form.register('phone')}
      />
      {error && <Alert>{error}</Alert>}
      <Button type="submit" loading={form.formState.isSubmitting}>
        ขอรหัส OTP
      </Button>
    </form>
  );
}

function OtpStep({
  phone,
  linkLine,
  onBack,
  onResult,
}: {
  phone: string;
  linkLine: boolean;
  onBack: () => void;
  onResult: (result: VendorAuthResult) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(60);
  const [resending, setResending] = useState(false);
  const form = useForm<{ code: string }>({ resolver: zodResolver(otpCodeSchema) });
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    timer.current = window.setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(timer.current);
  }, []);

  const submit = form.handleSubmit(async ({ code }) => {
    setError(null);
    try {
      const registrationToken = linkLine ? registrationDraft.load()?.registrationToken : undefined;
      onResult(await authApi.verifyOtp({ phone, code, registrationToken }));
    } catch (e) {
      form.resetField('code');
      setError(errorMessage(e));
    }
  });

  async function resend() {
    setError(null);
    setResending(true);
    try {
      const res = await authApi.requestOtp(phone);
      setResendIn(res.resendAfter);
    } catch (e) {
      const wait = retryAfter(e);
      if (wait !== null) setResendIn(wait);
      setError(errorMessage(e));
    } finally {
      setResending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-gray-600">
        ส่งรหัส {OTP_LENGTH} หลักไปที่{' '}
        <strong className="text-gray-900">{formatPhone(phone)}</strong> แล้ว (ใช้ได้ 5 นาที)
      </p>
      <TextField
        label="รหัส OTP"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={OTP_LENGTH}
        autoFocus
        className="text-center text-2xl tracking-[0.5em]"
        error={form.formState.errors.code?.message}
        {...form.register('code')}
      />
      {error && <Alert>{error}</Alert>}
      <Button type="submit" loading={form.formState.isSubmitting}>
        ยืนยัน
      </Button>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          เปลี่ยนเบอร์
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={resendIn > 0}
          loading={resending}
          onClick={() => void resend()}
        >
          {resendIn > 0 ? `ขอรหัสใหม่ (${resendIn})` : 'ขอรหัสใหม่'}
        </Button>
      </div>
    </form>
  );
}

/** วินาทีที่ต้องรอจาก RATE_LIMITED (ขอ OTP ถี่เกิน) — null ถ้าไม่ใช่ */
function retryAfter(error: unknown): number | null {
  const { code, details } = toApiError(error);
  const seconds = Number(
    (details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds,
  );
  return code === 'RATE_LIMITED' && Number.isFinite(seconds) ? seconds : null;
}
