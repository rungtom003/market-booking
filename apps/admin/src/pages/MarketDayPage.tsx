import { useMemo, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatIsoDateTh, setStallDayOverrideSchema } from '@market-booking/shared';
import type { Stall, StallDayOverride } from '@market-booking/shared';
import { StallMap, StallMapLegend } from '@market-booking/stall-map';
import type { StallMapItem } from '@market-booking/stall-map';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { adminApi } from '../api/admin';
import { errorMessage } from '../lib/errors';
import { formatBaht } from '../lib/format';

type Notice = { severity: 'success' | 'error'; text: string } | null;

/** ตั้งค่าล็อคเฉพาะวันขาย: ปิดล็อค / ราคาเฉพาะวัน — คลิกล็อคบนผัง */
export function MarketDayPage() {
  const { id = '', dayId = '' } = useParams();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<Stall | null>(null);

  const round = useQuery({ queryKey: ['round', id], queryFn: () => adminApi.rounds.get(id) });
  const zones = useQuery({ queryKey: ['zones'], queryFn: adminApi.zones.list });
  const stalls = useQuery({ queryKey: ['stalls'], queryFn: () => adminApi.stalls.list() });
  const overrides = useQuery({
    queryKey: ['overrides', dayId],
    queryFn: () => adminApi.marketDays.overrides(dayId),
  });

  const overrideOf = useMemo(
    () => new Map(overrides.data?.map((o) => [o.stallId, o])),
    [overrides.data],
  );
  // ผู้ค้าเห็นเฉพาะล็อคที่เปิดใช้งาน
  const active = useMemo(() => (stalls.data ?? []).filter((s) => s.isActive), [stalls.data]);
  const mapItems = useMemo(
    () =>
      active.map((s): StallMapItem => ({
        ...s,
        status: s.isReserved || overrideOf.get(s.id)?.isClosed ? 'UNAVAILABLE' : 'AVAILABLE',
      })),
    [active, overrideOf],
  );

  if (round.isPending) return <CircularProgress aria-label="กำลังโหลด" />;
  if (round.isError) return <Alert severity="error">{errorMessage(round.error)}</Alert>;
  const day = round.data.marketDays.find((d) => d.id === dayId);
  if (!day) return <Alert severity="error">ไม่พบวันขายนี้</Alert>;

  const editable = !day.isCancelled && round.data.status !== 'CANCELLED';
  const stallById = new Map(active.map((s) => [s.id, s]));
  const priceOf = (s: Stall) => overrideOf.get(s.id)?.priceOverride ?? s.price;

  const saved = (code: string, result: StallDayOverride | null) => {
    setNotice({
      severity: 'success',
      text: result ? `บันทึกล็อค ${code} แล้ว` : `ล้างการตั้งค่าล็อค ${code} แล้ว`,
    });
    void queryClient.invalidateQueries({ queryKey: ['overrides', dayId] });
    void queryClient.invalidateQueries({ queryKey: ['round', id] });
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Button
          component={RouterLink}
          to={`/rounds/${id}`}
          startIcon={<ArrowBackIcon />}
          size="small"
        >
          {round.data.name}
        </Button>
      </Box>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
        ตั้งค่าล็อค วัน{formatIsoDateTh(day.marketDate, true)}
      </Typography>
      {!editable && <Alert severity="info">วันขายนี้ถูกยกเลิกแล้ว ดูได้อย่างเดียว</Alert>}
      {notice && (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <StallMap
            stalls={mapItems}
            zones={zones.data ?? []}
            selectedId={editing?.id ?? null}
            isSelectable={() => editable}
            onSelect={(s) => setEditing(stallById.get(s.id) ?? null)}
            describe={(s) => {
              const stall = stallById.get(s.id);
              const closed = overrideOf.get(s.id)?.isClosed ? ' ปิดวันนี้' : '';
              return `ล็อค ${s.code}${closed}${stall ? ` ${formatBaht(priceOf(stall))}` : ''}`;
            }}
          />
          <StallMapLegend zones={zones.data ?? []} statuses={['UNAVAILABLE']} />
          <Typography variant="body2" color="text.secondary">
            คลิกล็อคเพื่อปิดหรือตั้งราคาเฉพาะวันนี้ · "ไม่เปิดจอง" = ปิดวันนี้หรือสงวนไว้
          </Typography>
        </Stack>
      </Paper>

      <Paper variant="outlined">
        <Typography variant="h6" sx={{ p: 2, pb: 1 }}>
          ล็อคที่ตั้งค่าเฉพาะวันนี้
        </Typography>
        <Table size="small" aria-label="ล็อคที่ตั้งค่าเฉพาะวันนี้">
          <TableHead>
            <TableRow>
              <TableCell>ล็อค</TableCell>
              <TableCell>สถานะวันนี้</TableCell>
              <TableCell align="right">ราคาวันนี้</TableCell>
              <TableCell align="right">ราคาปกติ</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {overrides.data?.map((o) => {
              const stall = stallById.get(o.stallId);
              return (
                <TableRow key={o.stallId}>
                  <TableCell>{o.stallCode}</TableCell>
                  <TableCell>{o.isClosed ? 'ปิด' : 'เปิด'}</TableCell>
                  <TableCell align="right">
                    {o.priceOverride === null ? '—' : formatBaht(o.priceOverride)}
                  </TableCell>
                  <TableCell align="right">{stall ? formatBaht(stall.price) : '—'}</TableCell>
                  <TableCell align="right">
                    {stall && editable && (
                      <Button size="small" onClick={() => setEditing(stall)}>
                        แก้ไข
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {overrides.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>ทุกล็อคใช้ค่าปกติ</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      {editing && (
        <OverrideDialog
          dayId={dayId}
          dateLabel={formatIsoDateTh(day.marketDate)}
          stall={editing}
          current={overrideOf.get(editing.id) ?? null}
          onClose={() => setEditing(null)}
          onSaved={(result) => saved(editing.code, result)}
        />
      )}
    </Stack>
  );
}

function OverrideDialog({
  dayId,
  dateLabel,
  stall,
  current,
  onClose,
  onSaved,
}: {
  dayId: string;
  dateLabel: string;
  stall: Stall;
  current: StallDayOverride | null;
  onClose: () => void;
  onSaved: (result: StallDayOverride | null) => void;
}) {
  const [isClosed, setIsClosed] = useState(current?.isClosed ?? false);
  const [price, setPrice] = useState(current?.priceOverride?.toString() ?? '');
  const [priceError, setPriceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (input: { priceOverride: number | null; isClosed: boolean }) =>
      adminApi.marketDays.setOverride(dayId, stall.id, input),
    onSuccess: (result) => {
      onClose();
      onSaved(result);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = () => {
    const parsed = setStallDayOverrideSchema.safeParse({
      priceOverride: price.trim() === '' ? null : Number(price),
      isClosed,
    });
    if (!parsed.success) {
      setPriceError(parsed.error.issues[0]?.message ?? 'ราคาไม่ถูกต้อง');
      return;
    }
    setPriceError(null);
    save.mutate(parsed.data);
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        ล็อค {stall.code} — {dateLabel}
      </DialogTitle>
      <DialogContent>
        {stall.isReserved && (
          <Alert severity="info" sx={{ mb: 1 }}>
            ล็อคนี้สงวนไว้ (ไม่เปิดจองออนไลน์ทุกวัน)
          </Alert>
        )}
        <FormControlLabel
          label="ปิดล็อคนี้ในวันนี้"
          control={<Checkbox checked={isClosed} onChange={(e) => setIsClosed(e.target.checked)} />}
        />
        <TextField
          label="ราคาเฉพาะวันนี้ (บาท)"
          type="number"
          fullWidth
          margin="normal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          error={Boolean(priceError)}
          helperText={priceError ?? `เว้นว่าง = ราคาปกติ ${formatBaht(stall.price)}`}
          slotProps={{ htmlInput: { step: 'any', min: 0 } }}
        />
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        {current && (
          <Button
            color="warning"
            sx={{ mr: 'auto' }}
            onClick={() => save.mutate({ priceOverride: null, isClosed: false })}
          >
            ใช้ค่าปกติ
          </Button>
        )}
        <Button onClick={onClose}>ยกเลิก</Button>
        <Button variant="contained" loading={save.isPending} onClick={submit}>
          บันทึก
        </Button>
      </DialogActions>
    </Dialog>
  );
}
