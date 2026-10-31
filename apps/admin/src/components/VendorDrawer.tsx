import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminVendorDetail } from '@market-booking/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { adminApi } from '../api/admin';
import { errorMessage } from '../lib/errors';
import { VENDOR_STATUS_COLOR, VENDOR_STATUS_TH, formatDateTime, formatPhone } from '../lib/format';

type DialogKind = 'reject' | 'suspend' | null;

/** รายละเอียดผู้ค้า + รูป + ปุ่มอนุมัติ/ปฏิเสธ/ระงับ (ปุ่มที่แสดงตามสถานะปัจจุบัน — §8.1) */
export function VendorDrawer({
  vendorId,
  onClose,
  onChanged,
}: {
  vendorId: string | null;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['vendors', 'detail', vendorId],
    queryFn: () => adminApi.vendors.detail(vendorId!),
    enabled: Boolean(vendorId),
    // URL รูปหมดอายุใน 5 นาที — โหลดใหม่ก่อนหมด
    refetchInterval: 4 * 60_000,
  });

  const action = useMutation({
    mutationFn: async (run: () => Promise<AdminVendorDetail>) => run(),
    onSuccess: (vendor, _run) => {
      queryClient.setQueryData(['vendors', 'detail', vendor.id], vendor);
      setDialog(null);
      setError(null);
      onChanged(`${vendor.firstName} ${vendor.lastName}: ${VENDOR_STATUS_TH[vendor.status]}`);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const v = detail.data;
  return (
    // อยู่เหนือ AppBar (AppBar ตั้ง zIndex สูงกว่า drawer เมนูถาวร)
    <Drawer
      anchor="right"
      open={Boolean(vendorId)}
      onClose={onClose}
      sx={{ zIndex: (t) => t.zIndex.modal }}
    >
      <Box
        sx={{ width: { xs: '100vw', sm: 480 }, p: 3 }}
        role="region"
        aria-label="รายละเอียดผู้ค้า"
      >
        {detail.isPending && <CircularProgress />}
        {detail.isError && <Alert severity="error">{errorMessage(detail.error)}</Alert>}
        {v && (
          <Stack spacing={2}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6">
                {v.firstName} {v.lastName}
              </Typography>
              <Chip label={VENDOR_STATUS_TH[v.status]} color={VENDOR_STATUS_COLOR[v.status]} />
            </Stack>
            <Info
              label="เบอร์"
              value={`${formatPhone(v.phone)}${v.phoneVerified ? ' (ยืนยันแล้ว)' : ' (ยังไม่ยืนยัน)'}`}
            />
            <Info label="LINE" value={v.lineLinked ? 'ผูกแล้ว' : 'ยังไม่ผูก'} />
            <Info label="ที่อยู่" value={v.address} />
            <Info label="ร้าน" value={v.shopName ?? '—'} />
            <Info label="ประเภทสินค้า" value={v.productCategory?.name ?? '—'} />
            <Info label="สมัครเมื่อ" value={formatDateTime(v.createdAt)} />
            {v.reviewedAt && (
              <Info
                label="ตรวจโดย"
                value={`${v.reviewedBy?.displayName ?? 'ระบบ (อนุมัติอัตโนมัติ)'} · ${formatDateTime(v.reviewedAt)}`}
              />
            )}
            {v.rejectReason && (
              <Alert severity="error">เหตุผลที่ไม่อนุมัติ: {v.rejectReason}</Alert>
            )}
            {v.suspendedUntil && (
              <Alert severity="warning">ระงับถึง {formatDateTime(v.suspendedUntil)}</Alert>
            )}

            <Divider />
            <Image label="รูปบัตรประชาชน" url={v.idCardImageUrl} />
            <Image label="รูปร้าน/สินค้า" url={v.shopImageUrl} />
            <Divider />

            {error && <Alert severity="error">{error}</Alert>}
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {v.status === 'PENDING' && (
                <>
                  <Button
                    variant="contained"
                    loading={action.isPending}
                    onClick={() => action.mutate(() => adminApi.vendors.approve(v.id))}
                  >
                    อนุมัติ
                  </Button>
                  <Button variant="outlined" color="error" onClick={() => setDialog('reject')}>
                    ไม่อนุมัติ
                  </Button>
                </>
              )}
              {v.status === 'APPROVED' && (
                <Button variant="outlined" color="warning" onClick={() => setDialog('suspend')}>
                  ระงับ
                </Button>
              )}
              {v.status === 'SUSPENDED' && (
                <Button
                  variant="contained"
                  loading={action.isPending}
                  onClick={() => action.mutate(() => adminApi.vendors.unsuspend(v.id))}
                >
                  ยกเลิกการระงับ
                </Button>
              )}
              <Button onClick={onClose}>ปิด</Button>
            </Stack>

            <ReasonDialog
              open={dialog === 'reject'}
              title="ไม่อนุมัติผู้ค้า"
              submitLabel="ยืนยันไม่อนุมัติ"
              loading={action.isPending}
              onClose={() => setDialog(null)}
              onSubmit={({ reason }) => action.mutate(() => adminApi.vendors.reject(v.id, reason))}
            />
            <ReasonDialog
              open={dialog === 'suspend'}
              title="ระงับผู้ค้า"
              submitLabel="ยืนยันระงับ"
              withUntil
              reasonOptional
              loading={action.isPending}
              onClose={() => setDialog(null)}
              onSubmit={({ reason, until }) =>
                action.mutate(() =>
                  adminApi.vendors.suspend(v.id, { until: until!, reason: reason || undefined }),
                )
              }
            />
          </Stack>
        )}
      </Box>
    </Drawer>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography>{value}</Typography>
    </Box>
  );
}

function Image({ label, url }: { label: string; url: string | null }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <Box
            component="img"
            src={url}
            alt={label}
            sx={{
              display: 'block',
              maxWidth: '100%',
              maxHeight: 280,
              borderRadius: 1,
              border: 1,
              borderColor: 'divider',
            }}
          />
        </a>
      ) : (
        <Typography color="text.secondary">ไม่ได้แนบ</Typography>
      )}
    </Box>
  );
}

/** dialog กรอกเหตุผล (+ วันสิ้นสุดการระงับ) */
function ReasonDialog({
  open,
  title,
  submitLabel,
  withUntil,
  reasonOptional,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  withUntil?: boolean;
  reasonOptional?: boolean;
  loading: boolean;
  onClose: () => void;
  onSubmit: (values: { reason: string; until?: string }) => void;
}) {
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const reasonOk = reasonOptional || reason.trim().length >= 3;
  const untilDate = until ? new Date(until) : null;
  const untilOk = !withUntil || (untilDate !== null && untilDate > new Date());

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {withUntil && (
          <TextField
            label="ระงับถึง"
            type="datetime-local"
            fullWidth
            margin="normal"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            error={Boolean(until) && !untilOk}
            helperText={Boolean(until) && !untilOk ? 'ต้องเป็นเวลาในอนาคต' : undefined}
          />
        )}
        <TextField
          label={reasonOptional ? 'เหตุผล (ไม่บังคับ)' : 'เหตุผล'}
          fullWidth
          multiline
          minRows={3}
          margin="normal"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          helperText={reasonOptional ? undefined : 'ผู้ค้าจะเห็นเหตุผลนี้ (อย่างน้อย 3 ตัวอักษร)'}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>ยกเลิก</Button>
        <Button
          variant="contained"
          color="error"
          disabled={!reasonOk || !untilOk}
          loading={loading}
          // datetime-local ไม่มี timezone — แปลงเป็น ISO ตามเวลาเครื่อง (เครื่อง admin อยู่ไทย)
          onClick={() => onSubmit({ reason: reason.trim(), until: untilDate?.toISOString() })}
        >
          {submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
