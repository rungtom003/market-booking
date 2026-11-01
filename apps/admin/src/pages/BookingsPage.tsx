import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BOOKING_STATUS_TH, Permission, formatIsoDateTh } from '@market-booking/shared';
import type {
  AdminBooking,
  AdminBookingStatusFilter,
  AdminMarketDayStalls,
  AdminPayment,
  AdminVendorListItem,
  BookingStatus,
} from '@market-booking/shared';
import { StallMap, StallMapLegend } from '@market-booking/stall-map';
import type { StallMapItem } from '@market-booking/stall-map';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
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
import { saveBlob } from '../lib/download';
import { formatBaht, formatDateTime, formatPhone } from '../lib/format';
import { useAdminMarketDaySocket } from '../lib/realtime';
import { useCan } from '../lib/session';

type Notice = { severity: 'success' | 'error'; text: string } | null;
type DayStall = AdminMarketDayStalls['stalls'][number];

const STATUS_COLOR = {
  HOLD: 'warning',
  PENDING_PAYMENT: 'info',
  PENDING_VERIFY: 'info',
  CONFIRMED: 'success',
  CANCELLED: 'default',
  EXPIRED: 'default',
} as const satisfies Record<BookingStatus, string>;

const STATUS_FILTERS: { value: AdminBookingStatusFilter | ''; label: string }[] = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'ACTIVE', label: 'ยังมีผล' },
  ...(Object.keys(BOOKING_STATUS_TH) as BookingStatus[]).map((s) => ({
    value: s,
    label: BOOKING_STATUS_TH[s],
  })),
];

function mapStatus(s: DayStall): StallMapItem['status'] {
  switch (s.status) {
    case 'HOLD':
      return 'HELD';
    case 'BOOKED':
      return 'BOOKED';
    case 'CLOSED':
      return 'UNAVAILABLE';
    default:
      return 'AVAILABLE';
  }
}

/** วันที่ (เวลาไทย) วันนี้ YYYY-MM-DD */
const todayBangkok = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

/** จัดการการจองต่อวันขาย: ผัง realtime (เห็นชื่อผู้ค้า) + ตาราง + ยกเลิก/จองแทน + export */
export function BookingsPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState<Notice>(null);
  const [selected, setSelected] = useState<DayStall | null>(null);
  const [cancelling, setCancelling] = useState<{ id: string; label: string } | null>(null);

  const days = useQuery({ queryKey: ['admin-days'], queryFn: adminApi.bookings.days });
  // ค่าเริ่มต้น: วันขายถัดไปที่ยังไม่ผ่าน (ไม่มี = วันล่าสุด)
  const defaultDay = useMemo(() => {
    const list = days.data ?? [];
    return (list.find((d) => d.marketDate >= todayBangkok()) ?? list.at(-1))?.id ?? '';
  }, [days.data]);
  const dayId = params.get('day') ?? defaultDay;
  const tab = params.get('tab') === 'table' ? 'table' : 'map';
  const setParam = (key: string, value: string) =>
    setParams(
      (p) => {
        p.set(key, value);
        return p;
      },
      { replace: true },
    );

  useAdminMarketDaySocket(dayId || null);
  const day = useQuery({
    queryKey: ['admin-day', dayId],
    queryFn: () => adminApi.bookings.dayStalls(dayId),
    enabled: Boolean(dayId),
  });

  const done = (text: string) => {
    setNotice({ severity: 'success', text });
    void queryClient.invalidateQueries({ queryKey: ['admin-day', dayId] });
    void queryClient.invalidateQueries({ queryKey: ['admin-bookings'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-days'] });
  };

  const download = useMutation({
    mutationFn: () => adminApi.bookings.exportDay(dayId),
    onSuccess: ({ blob, filename }) => {
      saveBlob(blob, filename);
    },
    onError: (e) => setNotice({ severity: 'error', text: errorMessage(e) }),
  });

  const zoneName = new Map(day.data?.zones.map((z) => [z.id, z.name]));
  const mapItems = useMemo(
    () => (day.data?.stalls ?? []).map((s) => ({ ...s, status: mapStatus(s) })),
    [day.data],
  );
  const current = days.data?.find((d) => d.id === dayId);

  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
        จัดการการจอง
      </Typography>
      {notice && (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
      {days.isError && <Alert severity="error">{errorMessage(days.error)}</Alert>}
      {days.data?.length === 0 && <Alert severity="info">ยังไม่มีวันขายของรอบที่เผยแพร่แล้ว</Alert>}

      {Boolean(days.data?.length) && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
          <TextField
            select
            label="วันขาย"
            size="small"
            value={dayId}
            onChange={(e) => {
              setSelected(null);
              setParam('day', e.target.value);
            }}
            sx={{ minWidth: 320 }}
          >
            {days.data?.map((d) => (
              <MenuItem key={d.id} value={d.id}>
                {formatIsoDateTh(d.marketDate, true)} · {d.roundName} ({d.activeBookings} การจอง)
                {d.isCancelled ? ' — ยกเลิกแล้ว' : ''}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="outlined"
            disabled={!dayId}
            loading={download.isPending}
            onClick={() => download.mutate()}
          >
            ดาวน์โหลดรายชื่อ (xlsx)
          </Button>
        </Stack>
      )}
      {current?.isCancelled && <Alert severity="warning">วันขายนี้ถูกยกเลิกแล้ว</Alert>}

      {dayId && (
        <Paper variant="outlined">
          <Tabs value={tab} onChange={(_, v: string) => setParam('tab', v)} sx={{ px: 2 }}>
            <Tab value="map" label="ผัง" />
            <Tab value="table" label="ตาราง" />
          </Tabs>
          {tab === 'map' ? (
            <Stack spacing={1.5} sx={{ p: 2 }}>
              {day.isError && <Alert severity="error">{errorMessage(day.error)}</Alert>}
              {day.data && (
                <>
                  <StallMap
                    stalls={mapItems}
                    zones={day.data.zones}
                    selectedId={selected?.id ?? null}
                    onSelect={(s) =>
                      setSelected(day.data.stalls.find((x) => x.id === s.id) ?? null)
                    }
                    subLabel={(s) =>
                      day.data.stalls.find((x) => x.id === s.id)?.booking?.vendor.name.split(' ')[0]
                    }
                    describe={(s) => {
                      const b = day.data.stalls.find((x) => x.id === s.id)?.booking;
                      return `ล็อค ${s.code}${b ? ` ${b.vendor.name}` : ''}`;
                    }}
                  />
                  <StallMapLegend
                    zones={day.data.zones}
                    statuses={['HELD', 'BOOKED', 'UNAVAILABLE']}
                  />
                  <Typography variant="body2" color="text.secondary">
                    คลิกล็อคเพื่อดูผู้จอง ยกเลิก หรือจองแทนผู้ค้า · ผังอัปเดตเองเมื่อมีการจอง
                  </Typography>
                </>
              )}
            </Stack>
          ) : (
            <BookingTable
              dayId={dayId}
              onCancel={(b) =>
                setCancelling({ id: b.id, label: `ล็อค ${b.stall.code} — ${b.vendor.name}` })
              }
            />
          )}
        </Paper>
      )}

      {selected && day.data && (
        <StallDialog
          stall={selected}
          zoneName={zoneName.get(selected.zoneId) ?? '—'}
          dayId={dayId}
          dayCancelled={day.data.marketDay.isCancelled}
          onClose={() => setSelected(null)}
          onCancel={(b) => {
            setSelected(null);
            setCancelling({ id: b.id, label: `ล็อค ${selected.code} — ${b.vendor.name}` });
          }}
          onBooked={(b) => {
            setSelected(null);
            done(`จองล็อค ${b.stall.code} ให้ ${b.vendor.name} แล้ว`);
          }}
          onPaidCash={(p) => {
            setSelected(null);
            done(`รับเงินสด ${formatBaht(p.amount)} — ล็อค ${p.booking.stallCode} จองสำเร็จ`);
          }}
        />
      )}
      {cancelling && (
        <CancelDialog
          bookingId={cancelling.id}
          label={cancelling.label}
          onClose={() => setCancelling(null)}
          onDone={() => {
            done(`ยกเลิกการจอง${cancelling.label} แล้ว`);
            setCancelling(null);
          }}
        />
      )}
    </Stack>
  );
}

function BookingTable({ dayId, onCancel }: { dayId: string; onCancel: (b: AdminBooking) => void }) {
  const [status, setStatus] = useState<AdminBookingStatusFilter | ''>('ACTIVE');
  const [q, setQ] = useState('');
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 50 });
  const list = useQuery({
    queryKey: ['admin-bookings', dayId, status, q, pagination],
    queryFn: () =>
      adminApi.bookings.list({
        marketDayId: dayId,
        status: status || undefined,
        q: q.trim() || undefined,
        page: pagination.page + 1,
        pageSize: pagination.pageSize,
      }),
  });

  const columns: GridColDef<AdminBooking>[] = [
    { field: 'stall', headerName: 'ล็อค', width: 90, valueGetter: (_, b) => b.stall.code },
    {
      field: 'vendor',
      headerName: 'ผู้ค้า',
      flex: 1,
      minWidth: 160,
      valueGetter: (_, b) => b.vendor.name,
    },
    {
      field: 'shop',
      headerName: 'ร้าน',
      flex: 1,
      minWidth: 120,
      valueGetter: (_, b) => b.vendor.shopName ?? '—',
    },
    {
      field: 'phone',
      headerName: 'เบอร์',
      width: 130,
      valueGetter: (_, b) => formatPhone(b.vendor.phone),
    },
    {
      field: 'status',
      headerName: 'สถานะ',
      width: 130,
      renderCell: ({ row }) => (
        <Chip size="small" color={STATUS_COLOR[row.status]} label={BOOKING_STATUS_TH[row.status]} />
      ),
    },
    {
      field: 'amount',
      headerName: 'ราคา',
      width: 110,
      valueGetter: (_, b) => formatBaht(b.amount),
    },
    {
      field: 'createdAt',
      headerName: 'จองเมื่อ',
      width: 160,
      valueGetter: (_, b) => formatDateTime(b.createdAt),
    },
    {
      field: 'actions',
      headerName: '',
      width: 110,
      sortable: false,
      renderCell: ({ row }) =>
        ['HOLD', 'PENDING_PAYMENT', 'PENDING_VERIFY', 'CONFIRMED'].includes(row.status) && (
          <Button size="small" color="error" onClick={() => onCancel(row)}>
            ยกเลิก
          </Button>
        ),
    },
  ];

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ p: 2, flexWrap: 'wrap', gap: 1 }}>
        <TextField
          select
          size="small"
          label="สถานะ"
          value={status}
          onChange={(e) => setStatus(e.target.value as AdminBookingStatusFilter | '')}
          sx={{ minWidth: 160 }}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          {STATUS_FILTERS.map((f) => (
            <MenuItem key={f.value} value={f.value}>
              {f.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="ค้นหา ผู้ค้า / ร้าน / เบอร์ / ล็อค"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          sx={{ minWidth: 280 }}
        />
      </Stack>
      <Box sx={{ height: 520 }}>
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
    </Box>
  );
}

function StallDialog({
  stall,
  zoneName,
  dayId,
  dayCancelled,
  onClose,
  onCancel,
  onBooked,
  onPaidCash,
}: {
  stall: DayStall;
  zoneName: string;
  dayId: string;
  dayCancelled: boolean;
  onClose: () => void;
  onCancel: (booking: NonNullable<DayStall['booking']>) => void;
  onBooked: (booking: AdminBooking) => void;
  onPaidCash: (payment: AdminPayment) => void;
}) {
  // รับเงินสดหน้างาน — เฉพาะผู้มีสิทธิ์ตรวจการชำระ (ADMIN/SUPER_ADMIN ในหน้านี้)
  const canCash = useCan(Permission.PAYMENTS_VERIFY);
  const [cashError, setCashError] = useState<string | null>(null);
  const cash = useMutation({
    mutationFn: (bookingId: string) => adminApi.payments.cash({ bookingId }),
    onSuccess: onPaidCash,
    onError: (e) => setCashError(errorMessage(e)),
  });
  const b = stall.booking;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        ล็อค {stall.code} · {zoneName}
      </DialogTitle>
      {b ? (
        <>
          <DialogContent>
            <Box
              component="dl"
              sx={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                columnGap: 2,
                rowGap: 1,
                m: 0,
              }}
            >
              <Typography component="dt" color="text.secondary">
                ผู้ค้า
              </Typography>
              <Typography component="dd" sx={{ m: 0 }}>
                {b.vendor.name}
              </Typography>
              <Typography component="dt" color="text.secondary">
                ร้าน
              </Typography>
              <Typography component="dd" sx={{ m: 0 }}>
                {b.vendor.shopName ?? '—'}
              </Typography>
              <Typography component="dt" color="text.secondary">
                เบอร์
              </Typography>
              <Typography component="dd" sx={{ m: 0 }}>
                {formatPhone(b.vendor.phone)}
              </Typography>
              <Typography component="dt" color="text.secondary">
                สถานะ
              </Typography>
              <Typography component="dd" sx={{ m: 0 }}>
                <Chip
                  size="small"
                  color={STATUS_COLOR[b.status]}
                  label={BOOKING_STATUS_TH[b.status]}
                />
              </Typography>
              <Typography component="dt" color="text.secondary">
                ราคา
              </Typography>
              <Typography component="dd" sx={{ m: 0 }}>
                {formatBaht(b.amount)}
              </Typography>
              {b.holdExpiresAt && b.status === 'HOLD' && (
                <>
                  <Typography component="dt" color="text.secondary">
                    ต้องยืนยันภายใน
                  </Typography>
                  <Typography component="dd" sx={{ m: 0 }}>
                    {formatDateTime(b.holdExpiresAt)}
                  </Typography>
                </>
              )}
              {b.paymentDueAt && b.status === 'PENDING_PAYMENT' && (
                <>
                  <Typography component="dt" color="text.secondary">
                    ชำระภายใน
                  </Typography>
                  <Typography component="dd" sx={{ m: 0 }}>
                    {formatDateTime(b.paymentDueAt)}
                  </Typography>
                </>
              )}
            </Box>
          </DialogContent>
          {cashError && (
            <Alert severity="error" sx={{ mx: 3 }}>
              {cashError}
            </Alert>
          )}
          <DialogActions>
            <Button onClick={onClose}>ปิด</Button>
            {canCash && b.status !== 'CONFIRMED' && (
              <Button variant="outlined" loading={cash.isPending} onClick={() => cash.mutate(b.id)}>
                รับเงินสด {formatBaht(b.amount)}
              </Button>
            )}
            <Button color="error" variant="contained" onClick={() => onCancel(b)}>
              ยกเลิกการจอง
            </Button>
          </DialogActions>
        </>
      ) : dayCancelled ? (
        <>
          <DialogContent>วันขายนี้ถูกยกเลิกแล้ว จองแทนไม่ได้</DialogContent>
          <DialogActions>
            <Button onClick={onClose}>ปิด</Button>
          </DialogActions>
        </>
      ) : (
        <BookOnBehalfForm stall={stall} dayId={dayId} onClose={onClose} onBooked={onBooked} />
      )}
    </Dialog>
  );
}

/** จองแทนผู้ค้า — ค้นหาผู้ค้าที่อนุมัติแล้ว, เลือกว่ายืนยันเลยหรือให้รอชำระ, ราคาเว้นว่าง = ราคาของวัน */
function BookOnBehalfForm({
  stall,
  dayId,
  onClose,
  onBooked,
}: {
  stall: DayStall;
  dayId: string;
  onClose: () => void;
  onBooked: (booking: AdminBooking) => void;
}) {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [vendor, setVendor] = useState<AdminVendorListItem | null>(null);
  const [status, setStatus] = useState<'CONFIRMED' | 'PENDING_PAYMENT'>('CONFIRMED');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  // ค้นหาหลังหยุดพิมพ์ 300 ms
  useEffect(() => {
    const t = setTimeout(() => setSearch(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);
  const vendors = useQuery({
    queryKey: ['vendors', 'search', search],
    queryFn: () =>
      adminApi.vendors.list({ status: 'APPROVED', q: search || undefined, pageSize: 20 }),
  });

  const save = useMutation({
    mutationFn: () =>
      adminApi.bookings.create({
        vendorId: vendor?.id,
        stallId: stall.id,
        marketDayId: dayId,
        status,
        ...(amount.trim() !== '' && { amount: Number(amount) }),
      }),
    onSuccess: onBooked,
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          จองแทนผู้ค้า (ข้ามเวลาเปิดรอบ/โควตา/ล็อคสงวนได้)
          {stall.status === 'CLOSED' && ' — ล็อคนี้ปิดหรือสงวนไว้ในวันนี้'}
        </Typography>
        <Autocomplete
          options={vendors.data?.data ?? []}
          loading={vendors.isFetching}
          value={vendor}
          onChange={(_, v) => setVendor(v)}
          inputValue={input}
          onInputChange={(_, v) => setInput(v)}
          filterOptions={(x) => x}
          getOptionLabel={(v) => `${v.firstName} ${v.lastName} · ${formatPhone(v.phone)}`}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          noOptionsText="ไม่พบผู้ค้าที่อนุมัติแล้ว"
          renderInput={(p) => (
            <TextField {...p} label="ผู้ค้า (ชื่อ / ร้าน / เบอร์)" margin="normal" />
          )}
        />
        <TextField
          select
          label="สถานะการจอง"
          fullWidth
          margin="normal"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <MenuItem value="CONFIRMED">ยืนยันเลย (ชำระแล้ว/ไม่ต้องชำระ)</MenuItem>
          <MenuItem value="PENDING_PAYMENT">รอชำระเงิน</MenuItem>
        </TextField>
        <TextField
          label="ราคา (บาท)"
          type="number"
          fullWidth
          margin="normal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          helperText={`เว้นว่าง = ราคาของวัน ${formatBaht(stall.price)}`}
          slotProps={{ htmlInput: { min: 0, step: 'any' } }}
        />
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>ยกเลิก</Button>
        <Button
          variant="contained"
          disabled={!vendor}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          จองแทน
        </Button>
      </DialogActions>
    </>
  );
}

function CancelDialog({
  bookingId,
  label,
  onClose,
  onDone,
}: {
  bookingId: string;
  label: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: () => adminApi.bookings.cancel(bookingId, reason.trim()),
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>ยกเลิกการจอง</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 1 }}>{label}</Typography>
        <TextField
          label="เหตุผล (ผู้ค้าเห็นข้อความนี้)"
          fullWidth
          multiline
          minRows={2}
          margin="normal"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={Boolean(error) && reason.trim() === ''}
        />
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>ไม่ยกเลิก</Button>
        <Button
          color="error"
          variant="contained"
          disabled={reason.trim() === ''}
          loading={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          ยืนยันยกเลิก
        </Button>
      </DialogActions>
    </Dialog>
  );
}
