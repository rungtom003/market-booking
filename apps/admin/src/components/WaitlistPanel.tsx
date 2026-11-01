import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WAITLIST_STATUS_TH, type AdminWaitlistEntry } from '@market-booking/shared';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { adminApi } from '../api/admin';
import { errorMessage } from '../lib/errors';
import { formatDateTime, formatPhone } from '../lib/format';

const STATUS_COLOR = {
  WAITING: 'default',
  NOTIFIED: 'info',
  FULFILLED: 'success',
  EXPIRED: 'warning',
  CANCELLED: 'default',
} as const satisfies Record<AdminWaitlistEntry['status'], string>;

/** ตรงกับที่ useAdminMarketDaySocket สั่งโหลดใหม่ */
const waitlistKey = (dayId: string) => ['admin-waitlists', dayId] as const;

/** คิวรอของวันขาย (Phase 9.2) — ระบบส่งสิทธิ์ให้เอง; เจ้าหน้าที่นำออกจากคิวได้ */
export function WaitlistPanel({
  dayId,
  onDone,
}: {
  dayId: string;
  onDone: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: waitlistKey(dayId),
    queryFn: () => adminApi.waitlists.list(dayId),
  });
  const remove = useMutation({
    mutationFn: (entry: AdminWaitlistEntry) => adminApi.waitlists.remove(entry.id),
    onSuccess: (entry) => {
      void queryClient.invalidateQueries({ queryKey: waitlistKey(dayId) });
      void queryClient.invalidateQueries({ queryKey: ['admin-day', dayId] });
      onDone(`นำ ${entry.vendor.name} ออกจากคิวแล้ว`);
    },
  });
  const open = list.data?.filter((e) => e.status === 'WAITING' || e.status === 'NOTIFIED') ?? [];
  const closed = (list.data?.length ?? 0) - open.length;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
          คิวรอ ({open.length})
        </Typography>
        <Typography variant="body2" color="text.secondary">
          ล็อคว่างเมื่อไร ระบบจองให้คิวแรกที่มีสิทธิ์อัตโนมัติ (ยืนยันภายในเวลาที่ตั้งไว้
          ไม่งั้นส่งต่อคิวถัดไป)
          {closed > 0 && ` · จบแล้ว ${closed} คิว`}
        </Typography>
        {list.isError && <Alert severity="error">{errorMessage(list.error)}</Alert>}
        {remove.isError && <Alert severity="error">{errorMessage(remove.error)}</Alert>}
        {open.length > 0 && (
          <Table size="small" aria-label="คิวรอ">
            <TableHead>
              <TableRow>
                <TableCell>ลำดับ</TableCell>
                <TableCell>ผู้ค้า</TableCell>
                <TableCell>รอ</TableCell>
                <TableCell>สถานะ</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {open.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.position}</TableCell>
                  <TableCell>
                    {e.vendor.name}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {formatPhone(e.vendor.phone)}
                      {e.vendor.shopName && ` · ${e.vendor.shopName}`}
                    </Typography>
                  </TableCell>
                  <TableCell>{e.stall ? `ล็อค ${e.stall.code}` : `ทั้ง${e.zone.name}`}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={WAITLIST_STATUS_TH[e.status]}
                      color={STATUS_COLOR[e.status]}
                    />
                    {e.status === 'NOTIFIED' && e.expiresAt && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block' }}
                      >
                        ยืนยันภายใน {formatDateTime(e.expiresAt)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      color="error"
                      loading={remove.isPending && remove.variables?.id === e.id}
                      onClick={() => remove.mutate(e)}
                    >
                      นำออก
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Stack>
    </Paper>
  );
}
