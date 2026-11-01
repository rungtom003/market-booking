import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CheckinDay,
  type CheckinEntry,
  type CheckinPhase,
  type CheckinResult,
  formatBangkokTime,
  formatIsoDateTh,
} from '@market-booking/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import LinearProgress from '@mui/material/LinearProgress';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { adminApi } from '../api/admin';
import { errorMessage } from '../lib/errors';
import { formatPhone } from '../lib/format';
import { decodeQrFile, startQrCamera } from '../lib/qr-reader';
import { useCheckinSocket } from '../lib/realtime';

/** วันที่ (เวลาไทย) วันนี้ YYYY-MM-DD */
const todayBangkok = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

const PHASE: Record<CheckinPhase, { label: string; color: 'default' | 'success' | 'warning' }> = {
  NOT_OPEN: { label: 'ยังไม่เปิดเช็คอิน', color: 'warning' },
  OPEN: { label: 'เปิดเช็คอินอยู่', color: 'success' },
  CLOSED: { label: 'ปิดเช็คอินแล้ว', color: 'default' },
};

type Outcome = { kind: 'ok'; result: CheckinResult } | { kind: 'error'; text: string };

/** สแกนชิ้นเดิมซ้ำภายในเวลานี้ไม่ส่งซ้ำ (กล้องอ่านได้หลายเฟรมต่อวินาที) */
const SAME_CODE_MS = 3_000;
/** กล้องหลังของมือถือ — เปิดเมื่อ mount, ปิดเมื่อ unmount; `onCode` เรียกทุกครั้งที่อ่านได้ */
function CameraScanner({
  onCode,
  onError,
}: {
  onCode: (text: string) => void;
  onError: (text: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const handler = useRef(onCode);
  useEffect(() => {
    handler.current = onCode;
  });

  useEffect(() => {
    const camera = new AbortController();
    startQrCamera(video.current!, (text) => handler.current(text), camera.signal).catch(
      (e: unknown) => {
        if (!camera.signal.aborted) {
          onError(
            `เปิดกล้องไม่ได้ — ${e instanceof Error ? e.message : String(e)} (อนุญาตการใช้กล้องในเบราว์เซอร์ หรือใช้การค้นหาด้านล่าง)`,
          );
        }
      },
    );
    return () => camera.abort();
  }, [onError]);

  return (
    <Box
      component="video"
      ref={video}
      muted
      playsInline
      aria-label="ภาพจากกล้อง"
      sx={{ width: '100%', maxWidth: 420, mx: 'auto', borderRadius: 1, bgcolor: 'black' }}
    />
  );
}

function OutcomeCard({ outcome }: { outcome: Outcome | null }) {
  if (!outcome) return null;
  if (outcome.kind === 'error') {
    return (
      <Alert severity="error" variant="filled" role="status" aria-label="ผลการเช็คอิน">
        {outcome.text}
      </Alert>
    );
  }
  const { entry, alreadyCheckedIn } = outcome.result;
  return (
    <Alert
      severity={alreadyCheckedIn ? 'warning' : 'success'}
      variant="filled"
      role="status"
      aria-label="ผลการเช็คอิน"
    >
      <Typography sx={{ fontWeight: 700, fontSize: 20 }}>
        {alreadyCheckedIn ? 'เช็คอินแล้ว' : 'เช็คอินสำเร็จ'} · ล็อค {entry.stall.code}
      </Typography>
      <Typography>
        {entry.vendor.name}
        {entry.vendor.shopName ? ` (${entry.vendor.shopName})` : ''}
      </Typography>
      {alreadyCheckedIn && entry.checkedInAt && (
        <Typography variant="body2">
          เช็คอินไปแล้วเมื่อ {formatBangkokTime(entry.checkedInAt)} น. — ไม่นับซ้ำ
        </Typography>
      )}
    </Alert>
  );
}

function entryChip(e: CheckinEntry) {
  if (e.checkedInAt) {
    return (
      <Chip size="small" color="success" label={`เช็คอิน ${formatBangkokTime(e.checkedInAt)}`} />
    );
  }
  if (e.noshow) return <Chip size="small" color="error" variant="outlined" label="ไม่มา" />;
  return <Chip size="small" variant="outlined" label="ยังไม่เช็คอิน" />;
}

/** ค้นหาด้วยรหัสล็อค ชื่อ ร้าน หรือเบอร์ (ไม่สนขีด/ช่องว่าง) */
function matches(e: CheckinEntry, q: string): boolean {
  const text = q.trim().toLowerCase();
  if (!text) return true;
  const digits = text.replace(/\D/g, '');
  return (
    e.stall.code.toLowerCase().includes(text) ||
    e.vendor.name.toLowerCase().includes(text) ||
    (e.vendor.shopName?.toLowerCase().includes(text) ?? false) ||
    (digits.length >= 3 && e.vendor.phone.includes(digits))
  );
}

function DayPanel({ day, date }: { day: CheckinDay; date: string }) {
  const queryClient = useQueryClient();
  const [camera, setCamera] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [search, setSearch] = useState('');
  const [confirming, setConfirming] = useState<CheckinEntry | null>(null);
  const last = useRef<{ text: string; at: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useCheckinSocket(day.marketDay.id, date);

  const done = (result: CheckinResult) => {
    setOutcome({ kind: 'ok', result });
    void queryClient.invalidateQueries({ queryKey: ['admin-checkin', date] });
  };
  const fail = (e: unknown) => setOutcome({ kind: 'error', text: errorMessage(e) });
  const scan = useMutation({
    mutationFn: (token: string) => adminApi.checkin.scan({ marketDayId: day.marketDay.id, token }),
    onSuccess: done,
    onError: fail,
  });
  const manual = useMutation({
    mutationFn: (e: CheckinEntry) => adminApi.checkin.manual(e.bookingId),
    onSuccess: (result) => {
      setConfirming(null);
      done(result);
    },
    onError: (e) => {
      setConfirming(null);
      fail(e);
    },
  });

  const onCode = (text: string) => {
    const now = Date.now();
    if (scan.isPending) return;
    if (last.current && last.current.text === text && now - last.current.at < SAME_CODE_MS) return;
    last.current = { text, at: now };
    scan.mutate(text.trim());
  };
  const onCameraError = useMemo(
    () => (text: string) => {
      setCamera(false);
      setOutcome({ kind: 'error', text });
    },
    [],
  );
  const scanFile = async (file: File) => {
    const text = await decodeQrFile(file).catch(() => null);
    if (!text) {
      setOutcome({ kind: 'error', text: 'ไม่พบ QR ในรูปนี้ — ลองถ่ายให้เห็น QR ชัดๆ เต็มกรอบ' });
      return;
    }
    last.current = null;
    onCode(text);
  };

  const { marketDay, entries } = day;
  const checkedIn = entries.filter((e) => e.checkedInAt).length;
  const shown = entries.filter((e) => matches(e, search));
  const phase = PHASE[marketDay.phase];

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Typography sx={{ fontWeight: 700 }}>
            วัน{formatIsoDateTh(marketDay.marketDate, true)}
          </Typography>
          <Chip size="small" color={phase.color} label={phase.label} />
          {marketDay.noshowProcessed && <Chip size="small" label="นับไม่มาขายแล้ว" />}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          เวลาเช็คอิน {formatBangkokTime(marketDay.openAt)}–
          {/* ค่าเริ่มต้นปิดเที่ยงคืน = จบวันขาย */}
          {formatBangkokTime(marketDay.closeAt).replace(/^00:00$/, '24:00')} น.
        </Typography>
        <Typography sx={{ mt: 1, fontSize: 18 }} aria-label="จำนวนที่เช็คอินแล้ว">
          เช็คอินแล้ว <strong>{checkedIn}</strong> / {entries.length} ล็อค
        </Typography>
        <LinearProgress
          variant="determinate"
          value={entries.length ? (checkedIn / entries.length) * 100 : 0}
          sx={{ mt: 1, height: 8, borderRadius: 4 }}
        />
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1}>
            <Button
              variant={camera ? 'outlined' : 'contained'}
              size="large"
              fullWidth
              onClick={() => setCamera((v) => !v)}
            >
              {camera ? 'ปิดกล้อง' : 'เปิดกล้องสแกน QR'}
            </Button>
            <Button variant="outlined" size="large" onClick={() => fileInput.current?.click()}>
              สแกนจากรูป
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              aria-label="สแกนจากรูปภาพ"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void scanFile(file);
              }}
            />
          </Stack>
          {camera && <CameraScanner onCode={onCode} onError={onCameraError} />}
          {scan.isPending && <LinearProgress />}
          <OutcomeCard outcome={outcome} />
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <TextField
          label="ค้นหา (รหัสล็อค / ชื่อ / ร้าน / เบอร์โทร)"
          fullWidth
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{ htmlInput: { inputMode: 'search' } }}
        />
        <List aria-label="รายการเช็คอิน" dense>
          {shown.map((e) => (
            <ListItem
              key={e.bookingId}
              aria-label={`ล็อค ${e.stall.code}`}
              divider
              secondaryAction={
                !e.checkedInAt &&
                marketDay.phase === 'OPEN' && (
                  <Button size="small" variant="contained" onClick={() => setConfirming(e)}>
                    เช็คอิน
                  </Button>
                )
              }
              sx={{ pr: 12 }}
            >
              <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography sx={{ fontWeight: 700 }}>{e.stall.code}</Typography>
                  {entryChip(e)}
                </Stack>
                <Typography variant="body2" noWrap>
                  {e.vendor.name}
                  {e.vendor.shopName ? ` · ${e.vendor.shopName}` : ''}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatPhone(e.vendor.phone)} · {e.stall.zoneName}
                </Typography>
              </Stack>
            </ListItem>
          ))}
          {shown.length === 0 && (
            <ListItem>
              <Typography color="text.secondary">
                {entries.length === 0 ? 'ไม่มีการจองที่ยืนยันแล้วในวันนี้' : 'ไม่พบรายการที่ค้นหา'}
              </Typography>
            </ListItem>
          )}
        </List>
      </Paper>

      <Dialog open={Boolean(confirming)} onClose={() => setConfirming(null)}>
        <DialogTitle>เช็คอินล็อค {confirming?.stall.code}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            ยืนยันว่า {confirming?.vendor.name} มาถึงตลาดแล้ว (ใช้เมื่อสแกน QR ไม่ได้)
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)}>ยกเลิก</Button>
          <Button
            variant="contained"
            loading={manual.isPending}
            onClick={() => confirming && manual.mutate(confirming)}
          >
            ยืนยันเช็คอิน
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

/** เช็คอินหน้างาน (Phase 10) — ใช้บนมือถือ: สแกน QR ของผู้ค้า หรือค้นหาแล้วกดเช็คอิน */
export function CheckinPage() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayBangkok();
  const day = useQuery({
    queryKey: ['admin-checkin', date],
    queryFn: () => adminApi.checkin.day(date),
  });

  return (
    <Stack spacing={2} sx={{ maxWidth: 640 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
      >
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
          เช็คอินหน้างาน
        </Typography>
        <TextField
          label="วันขาย"
          type="date"
          size="small"
          value={date}
          onChange={(e) =>
            e.target.value &&
            setParams(
              (p) => {
                p.set('date', e.target.value);
                return p;
              },
              { replace: true },
            )
          }
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Stack>
      {day.isPending && <LinearProgress />}
      {day.isError && <Alert severity="error">{errorMessage(day.error)}</Alert>}
      {day.isSuccess && !day.data && (
        <Alert severity="info">ไม่มีวันขายในวันที่ {formatIsoDateTh(date)} — เลือกวันขายอื่น</Alert>
      )}
      {day.data && <DayPanel key={day.data.marketDay.id} day={day.data} date={date} />}
    </Stack>
  );
}
