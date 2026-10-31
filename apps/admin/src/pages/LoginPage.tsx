import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { adminLoginSchema } from '@market-booking/shared';
import type { AdminLoginInput } from '@market-booking/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { adminApi } from '../api/admin';
import { errorMessage } from '../lib/errors';
import { useSession } from '../lib/session';

export function LoginPage() {
  const state = useSession();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [error, setError] = useState<string | null>(null);
  const form = useForm<AdminLoginInput>({ resolver: zodResolver(adminLoginSchema) });

  if (state.status === 'authenticated') return <Navigate to="/" replace />;

  const submit = form.handleSubmit(async ({ username, password }) => {
    setError(null);
    try {
      await adminApi.login(username, password);
      navigate(from, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <Box
      sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'grey.100', p: 2 }}
    >
      <Paper
        component="form"
        onSubmit={submit}
        noValidate
        sx={{ p: 4, width: '100%', maxWidth: 400 }}
      >
        <Typography variant="h5" sx={{ fontWeight: 700 }} gutterBottom>
          เข้าสู่ระบบผู้ดูแล
        </Typography>
        <TextField
          label="ชื่อผู้ใช้"
          autoComplete="username"
          fullWidth
          margin="normal"
          autoFocus
          error={Boolean(form.formState.errors.username)}
          helperText={form.formState.errors.username?.message}
          {...form.register('username')}
        />
        <TextField
          label="รหัสผ่าน"
          type="password"
          autoComplete="current-password"
          fullWidth
          margin="normal"
          error={Boolean(form.formState.errors.password)}
          helperText={form.formState.errors.password?.message}
          {...form.register('password')}
        />
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
        <Button
          type="submit"
          variant="contained"
          size="large"
          fullWidth
          sx={{ mt: 3 }}
          loading={form.formState.isSubmitting}
        >
          เข้าสู่ระบบ
        </Button>
      </Paper>
    </Box>
  );
}
