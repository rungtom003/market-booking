import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BOOKING_STATUS_TH,
  PAYMENT_METHOD_TH,
  PAYMENT_STATUS_TH,
  SLIP_CHECK_TH,
  formatIsoDateTh,
} from '@market-booking/shared';
import type { AdminPayment, PaymentStatus } from '@market-booking/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DataGrid, type GridColDef, type GridPaginationModel } from '@mui/x-data-grid';
import { adminApi } from '../api/admin';
import { errorMessage } from '../lib/errors';
import { formatBaht, formatDateTime, formatPhone } from '../lib/format';

type Notice = { severity: 'success' | 'error' | 'info'; text: string } | null;

const STATUS_COLOR = {
  PENDING: 'info',
  APPROVED: 'success',
  REJECTED: 'error',
} as const satisfies Record<PaymentStatus, string>;

/** เหตุผลที่ใช้บ่อย — กดแล้วเติมในช่อง แก้ต่อได้ */
const QUICK_REASONS = [
  'ยอดเงินไม่ตรงกับที่ต้องชำระ',
  'สลิปไม่ชัด อ่านไม่ได้',
  'บัญชีปลายทางไม่ถูกต้อง',
  'ไม่พบรายการโอนนี้',
];

/** ตรวจสลิป (Overview §9.5): คิวรอตรวจทีละใบ (คีย์ลัด) + ประวัติ */
export function PaymentsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'history' ? 'history' : 'queue';
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
        ตรวจสลิป
      </Typography>
      <Tabs
        value={tab}
        onChange={(_, v: string) => setParams({ tab: v }, { replace: true })}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="queue" label="รอตรวจ" />
        <Tab value="history" label="ประวัติ" />
      </Tabs>
      {tab === 'queue' ? <ReviewQueue /> : <History />}
    </Stack>
  );
}

function ReviewQueue() {
  const queryClient = useQueryClient();
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [rejecting, setRejecting] = useState<AdminPayment | null>(null);

  const queue = useQuery({
    queryKey: ['payments', 'queue'],
    queryFn: () => adminApi.payments.list({ status: 'PENDING', pageSize: 100 }),
  });
  const items = queue.data?.data ?? [];
  const position = Math.min(index, Math.max(0, items.length - 1));
  const current = items[position] ?? null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['payments'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-day'] });
  };
  const approve = useMutation({
    mutationFn: (p: AdminPayment) => adminApi.payments.approve(p.id),
    onSuccess: (p) => {
      setNotice({
        severity: 'success',
        text: `อนุมัติแล้ว — ล็อค ${p.booking.stallCode} ${p.vendor.name} จองสำเร็จ`,
      });
      refresh();
    },
    onError: (e) => {
      setNotice({ severity: 'error', text: errorMessage(e) });
      refresh();
    },
  });

  // คีย์ลัด: A อนุมัติ, R ไม่ผ่าน, ← → เลื่อนใบ (ไม่ทำงานขณะพิมพ์หรือเปิด dialog)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (rejecting || e.ctrlKey || e.metaKey || e.altKey) return;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (!current || approve.isPending) return;
      const key = e.key.toLowerCase();
      if (key === 'a') approve.mutate(current);
      else if (key === 'r') setRejecting(current);
      else if (e.key === 'ArrowRight') setIndex(Math.min(items.length - 1, position + 1));
      else if (e.key === 'ArrowLeft') setIndex(Math.max(0, position - 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, rejecting, approve, items.length, position]);

  if (queue.isPending) return <Typography>กำลังโหลด…</Typography>;
  if (queue.isError) return <Alert severity="error">{errorMessage(queue.error)}</Alert>;

  return (
    <Stack spacing={2}>
      {notice && (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
      {!current ? (
        <Alert severity="info">ไม่มีสลิปรอตรวจ — สลิปใหม่จะขึ้นที่นี่ทันที</Alert>
      ) : (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'stretch' }}>
          <Paper
            variant="outlined"
            sx={{
              flex: 3,
              bgcolor: 'grey.900',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 420,
              p: 1,
            }}
          >
            {current.slipUrl ? (
              <Link href={current.slipUrl} target="_blank" rel="noreferrer" title="เปิดรูปเต็ม">
                <Box
                  component="img"
                  src={current.slipUrl}
                  alt={`สลิปของ ${current.vendor.name}`}
                  sx={{ maxWidth: '100%', maxHeight: '70vh', display: 'block' }}
                />
              </Link>
            ) : (
              <Typography color="grey.400">ไม่มีรูปสลิป</Typography>
            )}
          </Paper>
          <Paper variant="outlined" sx={{ flex: 2, p: 2.5 }}>
            <Stack spacing={2} sx={{ height: '100%' }}>
              <Typography variant="body2" color="text.secondary">
                ใบที่ {position + 1} / {items.length} · ส่งเมื่อ {formatDateTime(current.createdAt)}
              </Typography>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  ยอดที่ต้องได้รับ
                </Typography>
                <Typography variant="h3" component="p" sx={{ fontWeight: 700 }}>
                  {formatBaht(current.amount)}
                </Typography>
              </Box>
              <Box
                component="dl"
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  columnGap: 2,
                  rowGap: 0.75,
                  m: 0,
                }}
              >
                <Typography component="dt" color="text.secondary">
                  ผู้ค้า
                </Typography>
                <Typography component="dd" sx={{ m: 0 }}>
                  {current.vendor.name} · {formatPhone(current.vendor.phone)}
                </Typography>
                <Typography component="dt" color="text.secondary">
                  ล็อค
                </Typography>
                <Typography component="dd" sx={{ m: 0 }}>
                  {current.booking.stallCode} · วัน
                  {formatIsoDateTh(current.booking.marketDate, true)}
                </Typography>
                <Typography component="dt" color="text.secondary">
                  การจอง
                </Typography>
                <Typography component="dd" sx={{ m: 0 }}>
                  {BOOKING_STATUS_TH[current.booking.status]}
                </Typography>
              </Box>
              {current.duplicateOf && (
                <Alert severity="error" aria-label="รูปสลิปซ้ำ">
                  รูปสลิปนี้เคยส่งมาแล้วกับล็อค {current.duplicateOf.stallCode} วัน
                  {formatIsoDateTh(current.duplicateOf.marketDate)} (
                  {current.duplicateOf.vendorName}, {PAYMENT_STATUS_TH[current.duplicateOf.status]})
                  — ตรวจให้แน่ใจก่อนอนุมัติ
                </Alert>
              )}
              {current.slipCheck && (
                <Alert severity={current.slipCheck === 'VALID' ? 'success' : 'info'}>
                  {SLIP_CHECK_TH[current.slipCheck]}
                </Alert>
              )}
              {current.booking.status !== 'PENDING_VERIFY' && (
                <Alert severity="warning">
                  การจองนี้ไม่ได้รอตรวจแล้ว ({BOOKING_STATUS_TH[current.booking.status]}) — กด
                  "ไม่ผ่าน" เพื่อปิดสลิป
                </Alert>
              )}
              <Box sx={{ flexGrow: 1 }} />
              <Stack direction="row" spacing={1}>
                <Button
                  fullWidth
                  size="large"
                  variant="contained"
                  color="success"
                  loading={approve.isPending}
                  disabled={current.booking.status !== 'PENDING_VERIFY'}
                  onClick={() => approve.mutate(current)}
                >
                  อนุมัติ (A)
                </Button>
                <Button
                  fullWidth
                  size="large"
                  variant="outlined"
                  color="error"
                  disabled={approve.isPending}
                  onClick={() => setRejecting(current)}
                >
                  ไม่ผ่าน (R)
                </Button>
              </Stack>
              <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                <Button disabled={position === 0} onClick={() => setIndex(position - 1)}>
                  ← ก่อนหน้า
                </Button>
                <Button
                  disabled={position >= items.length - 1}
                  onClick={() => setIndex(position + 1)}
                >
                  ถัดไป →
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </Stack>
      )}
      {rejecting && (
        <RejectDialog
          payment={rejecting}
          onClose={() => setRejecting(null)}
          onDone={(p) => {
            setRejecting(null);
            setNotice({
              severity: 'info',
              text: `ไม่ผ่าน — แจ้ง ${p.vendor.name} ให้ส่งสลิปใหม่แล้ว`,
            });
            refresh();
          }}
        />
      )}
    </Stack>
  );
}

function RejectDialog({
  payment,
  onClose,
  onDone,
}: {
  payment: AdminPayment;
  onClose: () => void;
  onDone: (p: AdminPayment) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reject = useMutation({
    mutationFn: () => adminApi.payments.reject(payment.id, reason.trim()),
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>สลิปไม่ผ่าน</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {payment.vendor.name} · ล็อค {payment.booking.stallCode} · {formatBaht(payment.amount)}
        </Typography>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mb: 1 }}>
          {QUICK_REASONS.map((r) => (
            <Chip key={r} label={r} onClick={() => setReason(r)} variant="outlined" />
          ))}
        </Stack>
        <TextField
          label="เหตุผล (ผู้ค้าเห็นข้อความนี้)"
          fullWidth
          multiline
          minRows={2}
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>ยกเลิก</Button>
        <Button
          color="error"
          variant="contained"
          disabled={reason.trim().length < 3}
          loading={reject.isPending}
          onClick={() => reject.mutate()}
        >
          ยืนยันไม่ผ่าน
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function History() {
  const [status, setStatus] = useState<PaymentStatus | ''>('');
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 50 });
  const list = useQuery({
    queryKey: ['payments', 'history', status, pagination],
    queryFn: () =>
      adminApi.payments.list({
        status: status || undefined,
        page: pagination.page + 1,
        pageSize: pagination.pageSize,
      }),
  });

  const columns: GridColDef<AdminPayment>[] = [
    {
      field: 'createdAt',
      headerName: 'ส่งเมื่อ',
      width: 160,
      valueGetter: (_, p) => formatDateTime(p.createdAt),
    },
    {
      field: 'vendor',
      headerName: 'ผู้ค้า',
      flex: 1,
      minWidth: 150,
      valueGetter: (_, p) => p.vendor.name,
    },
    { field: 'stall', headerName: 'ล็อค', width: 90, valueGetter: (_, p) => p.booking.stallCode },
    {
      field: 'marketDate',
      headerName: 'วันขาย',
      width: 130,
      valueGetter: (_, p) => formatIsoDateTh(p.booking.marketDate),
    },
    {
      field: 'method',
      headerName: 'วิธี',
      width: 150,
      valueGetter: (_, p) => PAYMENT_METHOD_TH[p.method],
    },
    { field: 'amount', headerName: 'ยอด', width: 110, valueGetter: (_, p) => formatBaht(p.amount) },
    {
      field: 'status',
      headerName: 'สถานะ',
      width: 120,
      renderCell: ({ row }) => (
        <Chip size="small" color={STATUS_COLOR[row.status]} label={PAYMENT_STATUS_TH[row.status]} />
      ),
    },
    {
      field: 'verifiedBy',
      headerName: 'ตรวจโดย',
      width: 140,
      valueGetter: (_, p) => p.verifiedByName ?? (p.verifiedAt ? 'ระบบ' : '—'),
    },
    {
      field: 'reason',
      headerName: 'เหตุผล',
      flex: 1,
      minWidth: 160,
      valueGetter: (_, p) => p.rejectReason ?? '',
    },
    {
      field: 'slip',
      headerName: 'สลิป',
      width: 80,
      sortable: false,
      renderCell: ({ row }) =>
        row.slipUrl && (
          <Link href={row.slipUrl} target="_blank" rel="noreferrer">
            ดูรูป
          </Link>
        ),
    },
  ];

  return (
    <Paper variant="outlined">
      <Box sx={{ p: 2 }}>
        <TextField
          select
          size="small"
          label="สถานะ"
          value={status}
          onChange={(e) => setStatus(e.target.value as PaymentStatus | '')}
          sx={{ minWidth: 180 }}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          <MenuItem value="">ทั้งหมด</MenuItem>
          {(Object.keys(PAYMENT_STATUS_TH) as PaymentStatus[]).map((s) => (
            <MenuItem key={s} value={s}>
              {PAYMENT_STATUS_TH[s]}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <Box sx={{ height: 560 }}>
        <DataGrid
          rows={list.data?.data ?? []}
          columns={columns}
          rowCount={list.data?.meta?.total ?? 0}
          loading={list.isFetching}
          paginationMode="server"
          paginationModel={pagination}
          onPaginationModelChange={setPagination}
          pageSizeOptions={[50, 100]}
          disableRowSelectionOnClick
          sx={{ border: 0 }}
        />
      </Box>
    </Paper>
  );
}
