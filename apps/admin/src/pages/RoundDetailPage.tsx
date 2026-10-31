import { useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatIsoDateTh } from '@market-booking/shared';
import type { RoundDetail, RoundMarketDay } from '@market-booking/shared';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { adminApi } from '../api/admin';
import { MarketDayCalendar } from '../components/MarketDayCalendar';
import { RoundDialog } from '../components/RoundDialog';
import { errorMessage } from '../lib/errors';
import { firstAllowedMarketDate, formatDateTime, roundStateChip } from '../lib/format';

type Notice = { severity: 'success' | 'error'; text: string } | null;
type Confirm = { title: string; text: string; label: string; run: () => void } | null;

/** รายละเอียดรอบ: เผยแพร่/ยกเลิก/ลบ + วันขาย (เพิ่มจากปฏิทิน, ยกเลิก, ตั้งค่าล็อครายวัน) */
export function RoundDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<Notice>(() => {
    const text = (location.state as { notice?: string } | null)?.notice;
    return text ? { severity: 'success', text } : null;
  });
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const round = useQuery({ queryKey: ['round', id], queryFn: () => adminApi.rounds.get(id) });

  const done = (detail: RoundDetail, text: string) => {
    queryClient.setQueryData(['round', id], detail);
    void queryClient.invalidateQueries({ queryKey: ['rounds'] });
    setNotice({ severity: 'success', text });
  };
  const onError = (e: unknown) => setNotice({ severity: 'error', text: errorMessage(e) });

  const publish = useMutation({
    mutationFn: () => adminApi.rounds.publish(id),
    onSuccess: (r) => done(r, 'เผยแพร่รอบแล้ว ผู้ค้าเห็นรอบนี้แล้ว'),
    onError,
  });
  const cancel = useMutation({
    mutationFn: () => adminApi.rounds.cancel(id),
    onSuccess: (r) => done(r, 'ยกเลิกรอบแล้ว'),
    onError,
  });
  const remove = useMutation({
    mutationFn: () => adminApi.rounds.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rounds'] });
      void navigate('/rounds');
    },
    onError,
  });
  const setDayCancelled = useMutation({
    mutationFn: ({ day, isCancelled }: { day: RoundMarketDay; isCancelled: boolean }) =>
      adminApi.rounds.updateDay(id, day.id, { isCancelled }),
    onSuccess: (r, { day, isCancelled }) =>
      done(
        r,
        `${isCancelled ? 'ยกเลิก' : 'คืนสถานะ'}วันขาย ${formatIsoDateTh(day.marketDate)} แล้ว`,
      ),
    onError,
  });
  const removeDay = useMutation({
    mutationFn: (day: RoundMarketDay) => adminApi.rounds.removeDay(id, day.id).then(() => day),
    onSuccess: (day) => {
      void queryClient.invalidateQueries({ queryKey: ['round', id] });
      void queryClient.invalidateQueries({ queryKey: ['rounds'] });
      setNotice({ severity: 'success', text: `ลบวันขาย ${formatIsoDateTh(day.marketDate)} แล้ว` });
    },
    onError,
  });

  if (round.isPending) return <CircularProgress aria-label="กำลังโหลด" />;
  if (round.isError) return <Alert severity="error">{errorMessage(round.error)}</Alert>;

  const r = round.data;
  const chip = roundStateChip(r);
  const cancelled = r.status === 'CANCELLED';

  return (
    <Stack spacing={2}>
      <Box>
        <Button component={RouterLink} to="/rounds" startIcon={<ArrowBackIcon />} size="small">
          รอบการจองทั้งหมด
        </Button>
      </Box>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
          {r.name}
        </Typography>
        <Chip color={chip.color} label={chip.label} />
      </Stack>
      {notice && (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Box
          component="dl"
          sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 3, rowGap: 1, m: 0 }}
        >
          <Typography component="dt" color="text.secondary">
            เปิดจอง
          </Typography>
          <Typography component="dd" sx={{ m: 0 }}>
            {formatDateTime(r.openAt)}
          </Typography>
          <Typography component="dt" color="text.secondary">
            ปิดจอง
          </Typography>
          <Typography component="dd" sx={{ m: 0 }}>
            {formatDateTime(r.closeAt)}
          </Typography>
          <Typography component="dt" color="text.secondary">
            ล็อคสูงสุดต่อผู้ค้า
          </Typography>
          <Typography component="dd" sx={{ m: 0 }}>
            {r.maxStallsPerVendor} ล็อค ต่อวันขาย
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', gap: 1 }}>
          {!cancelled && (
            <Button variant="outlined" onClick={() => setEditing(true)}>
              แก้ไขรอบ
            </Button>
          )}
          {r.status === 'DRAFT' && (
            <Button
              variant="contained"
              loading={publish.isPending}
              disabled={r.marketDayCount === 0}
              title={r.marketDayCount === 0 ? 'เพิ่มวันขายก่อนเผยแพร่' : undefined}
              onClick={() => publish.mutate()}
            >
              เผยแพร่รอบ
            </Button>
          )}
          {r.status === 'PUBLISHED' && (
            <Button
              color="error"
              variant="outlined"
              onClick={() =>
                setConfirm({
                  title: 'ยกเลิกรอบนี้?',
                  text: 'วันขายทั้งหมดของรอบจะถูกยกเลิก และผู้ค้าจะไม่เห็นรอบนี้อีก — ย้อนกลับไม่ได้',
                  label: 'ยืนยันยกเลิกรอบ',
                  run: () => cancel.mutate(),
                })
              }
            >
              ยกเลิกรอบ
            </Button>
          )}
          {r.status === 'DRAFT' && (
            <Button
              color="error"
              onClick={() =>
                setConfirm({
                  title: 'ลบรอบนี้?',
                  text: 'รอบและวันขายทั้งหมดจะถูกลบ',
                  label: 'ยืนยันลบรอบ',
                  run: () => remove.mutate(),
                })
              }
            >
              ลบรอบ
            </Button>
          )}
        </Stack>
      </Paper>

      <Paper variant="outlined">
        <Stack direction="row" sx={{ p: 2, justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">วันขาย ({r.marketDayCount} วัน)</Typography>
          {!cancelled && (
            <Button variant="contained" onClick={() => setAdding(true)}>
              เพิ่มวันขาย
            </Button>
          )}
        </Stack>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="วันขาย">
            <TableHead>
              <TableRow>
                <TableCell>วันที่</TableCell>
                <TableCell>สถานะ</TableCell>
                <TableCell align="right">ล็อคที่ตั้งค่าเฉพาะวัน</TableCell>
                <TableCell align="right">การจอง</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {r.marketDays.map((d) => (
                <TableRow key={d.id}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {formatIsoDateTh(d.marketDate, true)}
                  </TableCell>
                  <TableCell>
                    {d.isCancelled ? (
                      <Chip size="small" color="error" label="ยกเลิก" />
                    ) : (
                      <Chip size="small" color="success" label="ขายตามปกติ" />
                    )}
                  </TableCell>
                  <TableCell align="right">{d.overrideCount}</TableCell>
                  <TableCell align="right">{d.bookingCount}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Button
                      size="small"
                      component={RouterLink}
                      to={`/rounds/${r.id}/days/${d.id}`}
                      aria-label={`ตั้งค่าล็อค ${formatIsoDateTh(d.marketDate)}`}
                    >
                      ตั้งค่าล็อค
                    </Button>
                    {!cancelled && (
                      <Button
                        size="small"
                        color={d.isCancelled ? 'primary' : 'warning'}
                        onClick={() =>
                          setDayCancelled.mutate({ day: d, isCancelled: !d.isCancelled })
                        }
                      >
                        {d.isCancelled ? 'คืนสถานะ' : 'ยกเลิกวัน'}
                      </Button>
                    )}
                    {!cancelled && (
                      <Button
                        size="small"
                        color="error"
                        disabled={d.bookingCount > 0}
                        title={d.bookingCount > 0 ? 'มีการจองแล้ว ใช้ยกเลิกวันแทน' : undefined}
                        aria-label={`ลบวันขาย ${formatIsoDateTh(d.marketDate)}`}
                        onClick={() => removeDay.mutate(d)}
                      >
                        ลบ
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {r.marketDays.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    ยังไม่มีวันขาย — กด "เพิ่มวันขาย" เพื่อเลือกจากปฏิทิน
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </Paper>

      {editing && (
        <RoundDialog
          round={r}
          onClose={() => setEditing(false)}
          onSaved={(saved) => done(saved, 'บันทึกรอบแล้ว')}
        />
      )}
      {adding && (
        <AddDaysDialog
          round={r}
          onClose={() => setAdding(false)}
          onDone={(saved, count) => done(saved, `เพิ่มวันขาย ${count} วันแล้ว`)}
        />
      )}
      {confirm && (
        <Dialog open onClose={() => setConfirm(null)}>
          <DialogTitle>{confirm.title}</DialogTitle>
          <DialogContent>
            <DialogContentText>{confirm.text}</DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirm(null)}>ไม่ใช่</Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => {
                confirm.run();
                setConfirm(null);
              }}
            >
              {confirm.label}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}

function AddDaysDialog({
  round,
  onClose,
  onDone,
}: {
  round: RoundDetail;
  onClose: () => void;
  onDone: (round: RoundDetail, count: number) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const existing = new Set(round.marketDays.filter((d) => !d.isCancelled).map((d) => d.marketDate));
  const dates = [...selected].sort();

  const save = useMutation({
    mutationFn: () => adminApi.rounds.addDays(round.id, { dates }),
    onSuccess: (r) => {
      onClose();
      onDone(r, dates.length);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>เพิ่มวันขาย</DialogTitle>
      <DialogContent>
        <DialogContentText variant="body2" sx={{ mb: 1 }}>
          วันขายต้องอยู่หลังเวลาปิดจอง ({formatDateTime(round.closeAt)})
        </DialogContentText>
        <MarketDayCalendar
          minDate={firstAllowedMarketDate(round.closeAt)}
          existing={existing}
          selected={selected}
          onChange={setSelected}
        />
        <Typography variant="body2" sx={{ mt: 2 }} aria-live="polite">
          {dates.length === 0
            ? 'ยังไม่ได้เลือกวัน'
            : `เลือก ${dates.length} วัน: ${dates.map((d) => formatIsoDateTh(d)).join(', ')}`}
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>ยกเลิก</Button>
        <Button
          variant="contained"
          disabled={dates.length === 0}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          {dates.length > 0 ? `เพิ่ม ${dates.length} วัน` : 'เพิ่มวันขาย'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
