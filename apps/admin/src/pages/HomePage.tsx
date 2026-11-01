import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Permission, hasPermission } from '@market-booking/shared';
import type { DashboardRound } from '@market-booking/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { adminApi } from '../api/admin';
import { errorMessage } from '../lib/errors';
import { ADMIN_ROLE_TH, formatBaht, formatDateTime, roundStateChip } from '../lib/format';
import { NAV_ITEMS } from '../lib/nav';
import { useAdmin } from '../lib/session';

const percent = (rate: number) =>
  `${(rate * 100).toLocaleString('th-TH', { maximumFractionDigits: 1 })}%`;

function StatCard({
  title,
  value,
  children,
  action,
}: {
  title: string;
  value: ReactNode;
  children?: ReactNode;
  action?: { to: string; label: string };
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="body2" color="text.secondary">
        {title}
      </Typography>
      <Typography variant="h4" component="p" sx={{ fontWeight: 600 }}>
        {value}
      </Typography>
      {children}
      {action && (
        <Box sx={{ mt: 'auto' }}>
          <Button component={Link} to={action.to} size="small">
            {action.label}
          </Button>
        </Box>
      )}
    </Paper>
  );
}

function RoundCards({ round }: { round: DashboardRound }) {
  const chip = roundStateChip({ status: 'PUBLISHED', phase: round.phase });
  return (
    <>
      <StatCard
        title={`อัตราการจอง · ${round.name}`}
        value={percent(round.occupancyRate)}
        action={{ to: '/reports', label: 'ดูรายงาน' }}
      >
        <LinearProgress
          variant="determinate"
          value={Math.min(100, round.occupancyRate * 100)}
          aria-label="อัตราการจองรอบปัจจุบัน"
          sx={{ height: 8, borderRadius: 4 }}
        />
        <Typography variant="body2" color="text.secondary">
          จองสำเร็จ {round.confirmed.toLocaleString('th-TH')} /{' '}
          {round.capacity.toLocaleString('th-TH')} ล็อค
          {round.pending > 0 && ` · รอชำระ/ตรวจ ${round.pending.toLocaleString('th-TH')}`} ·{' '}
          {round.marketDays} วันขาย
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Chip size="small" label={chip.label} color={chip.color} />
          <Typography variant="caption" color="text.secondary">
            {formatDateTime(round.openAt)} – {formatDateTime(round.closeAt)}
          </Typography>
        </Stack>
      </StatCard>
      <StatCard title={`รายได้ · ${round.name}`} value={formatBaht(round.revenue)}>
        <Typography variant="body2" color="text.secondary">
          ยอดชำระที่อนุมัติแล้ว
          {round.revenuePending > 0 && ` · รอชำระ/ตรวจอีก ${formatBaht(round.revenuePending)}`}
        </Typography>
      </StatCard>
    </>
  );
}

/** หน้าแรก — Dashboard (Phase 8): งานที่รอ + ภาพรวมรอบปัจจุบัน; โหลดใหม่ทุก 30 วินาที */
export function HomePage() {
  const admin = useAdmin();
  const canReport = hasPermission(admin.role, Permission.REPORTS_VIEW);
  const dashboard = useQuery({
    queryKey: ['reports', 'dashboard'],
    queryFn: adminApi.reports.dashboard,
    enabled: canReport,
    refetchInterval: 30_000,
  });
  const items = NAV_ITEMS.filter(
    (i) => i.to !== '/' && (!i.permission || hasPermission(admin.role, i.permission)),
  );
  const d = dashboard.data;

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5">สวัสดี {admin.displayName}</Typography>
        <Typography color="text.secondary">บทบาท: {ADMIN_ROLE_TH[admin.role]}</Typography>
      </Box>

      {dashboard.isError && <Alert severity="error">{errorMessage(dashboard.error)}</Alert>}
      {canReport && (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 2fr 1.5fr' },
          }}
        >
          {!d ? (
            [0, 1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={150} />)
          ) : (
            <>
              <StatCard
                title="ผู้ค้ารออนุมัติ"
                value={d.pendingVendors.toLocaleString('th-TH')}
                action={
                  hasPermission(admin.role, Permission.VENDORS_REVIEW)
                    ? { to: '/vendors', label: 'ตรวจผู้ค้า' }
                    : undefined
                }
              />
              <StatCard
                title="สลิปรอตรวจ"
                value={d.pendingPayments.toLocaleString('th-TH')}
                action={
                  hasPermission(admin.role, Permission.PAYMENTS_VERIFY)
                    ? { to: '/payments', label: 'ตรวจสลิป' }
                    : undefined
                }
              />
              {d.round ? (
                <RoundCards round={d.round} />
              ) : (
                <Paper variant="outlined" sx={{ p: 2, gridColumn: { lg: 'span 2' } }}>
                  <Typography color="text.secondary">ยังไม่มีรอบการจองที่เผยแพร่</Typography>
                </Paper>
              )}
            </>
          )}
        </Box>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          เมนู
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {items.map((i) => (
            <Button key={i.to} component={Link} to={i.to} variant="outlined" startIcon={i.icon}>
              {i.label}
            </Button>
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}
