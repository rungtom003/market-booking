import { forwardRef, useMemo, useState } from 'react';
import type { ComponentProps } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import {
  MAX_BULK_STALLS,
  bulkCreateStallsSchema,
  bulkStallCodes,
  createStallSchema,
} from '@market-booking/shared';
import type { BulkCreateStallsInput, CreateStallInput, Stall, Zone } from '@market-booking/shared';
import { StallMap, StallMapLegend } from '@market-booking/stall-map';
import type { StallMapItem } from '@market-booking/stall-map';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DataGrid } from '@mui/x-data-grid';
import type { GridColDef } from '@mui/x-data-grid';
import { adminApi } from '../api/admin';
import { errorMessage } from '../lib/errors';
import { formatBaht } from '../lib/format';

type Notice = { severity: 'success' | 'error'; text: string } | null;

/** ค่าจาก `<input type="number">` → number (ช่องว่าง = undefined ให้ schema ตัดสิน) */
const toNumber = (v: unknown) =>
  v === '' || v === null || v === undefined ? undefined : Number(v);

function mapStatus(s: Stall): StallMapItem['status'] {
  if (!s.isActive) return 'INACTIVE';
  return s.isReserved ? 'UNAVAILABLE' : 'AVAILABLE';
}

/** จัดการล็อค: ผังตลาด (คลิกล็อคเพื่อแก้) + ตาราง + สร้างทีละหลายล็อค */
export function StallsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'map' | 'table'>('map');
  const [zoneFilter, setZoneFilter] = useState('');
  const [editing, setEditing] = useState<Stall | 'new' | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const zones = useQuery({ queryKey: ['zones'], queryFn: adminApi.zones.list });
  const stalls = useQuery({ queryKey: ['stalls'], queryFn: () => adminApi.stalls.list() });
  const zoneById = useMemo(() => new Map(zones.data?.map((z) => [z.id, z])), [zones.data]);

  const visible = useMemo(
    () => (stalls.data ?? []).filter((s) => !zoneFilter || s.zoneId === zoneFilter),
    [stalls.data, zoneFilter],
  );
  const mapItems = useMemo(() => visible.map((s) => ({ ...s, status: mapStatus(s) })), [visible]);

  const refresh = (text: string) => {
    setNotice({ severity: 'success', text });
    void queryClient.invalidateQueries({ queryKey: ['stalls'] });
    void queryClient.invalidateQueries({ queryKey: ['zones'] });
  };

  const columns: GridColDef<Stall>[] = [
    { field: 'code', headerName: 'รหัส', width: 100 },
    {
      field: 'zoneId',
      headerName: 'โซน',
      flex: 1,
      minWidth: 140,
      valueGetter: (v: string) => zoneById.get(v)?.name ?? '—',
    },
    {
      field: 'size',
      headerName: 'ขนาด (ม.)',
      width: 110,
      valueGetter: (_: unknown, row) => `${row.widthM} × ${row.lengthM}`,
    },
    {
      field: 'price',
      headerName: 'ราคา/วัน',
      width: 110,
      type: 'number',
      valueFormatter: (v: number) => formatBaht(v),
    },
    {
      field: 'pos',
      headerName: 'ตำแหน่ง (x, y)',
      width: 130,
      valueGetter: (_: unknown, row) => `${row.posX}, ${row.posY}`,
    },
    {
      field: 'flags',
      headerName: 'สถานะ',
      flex: 1,
      minWidth: 200,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', height: '100%' }}>
          {!row.isActive && <Chip size="small" label="ปิดใช้งาน" />}
          {row.isReserved && <Chip size="small" color="warning" label="สงวนไว้" />}
          {row.hasBookings && <Chip size="small" variant="outlined" label="มีประวัติการจอง" />}
        </Stack>
      ),
    },
  ];

  const noZones = zones.data?.length === 0;

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
      >
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          ล็อคและผังตลาด
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" disabled={noZones} onClick={() => setBulkOpen(true)}>
            สร้างหลายล็อค
          </Button>
          <Button variant="contained" disabled={noZones} onClick={() => setEditing('new')}>
            เพิ่มล็อค
          </Button>
        </Stack>
      </Stack>
      {noZones && <Alert severity="info">สร้างโซนก่อน ที่เมนู "โซนและประเภทสินค้า"</Alert>}
      {notice && (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      <Paper variant="outlined">
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{ px: 2, justifyContent: 'space-between', alignItems: { sm: 'center' } }}
        >
          <Tabs value={tab} onChange={(_, v: 'map' | 'table') => setTab(v)}>
            <Tab value="map" label="ผังตลาด" />
            <Tab value="table" label={`ตาราง (${visible.length})`} />
          </Tabs>
          <TextField
            select
            size="small"
            label="โซน"
            value={zoneFilter}
            onChange={(e) => setZoneFilter(e.target.value)}
            sx={{ minWidth: 180, my: 1 }}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          >
            <MenuItem value="">ทุกโซน</MenuItem>
            {zones.data?.map((z) => (
              <MenuItem key={z.id} value={z.id}>
                {z.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        {tab === 'map' ? (
          <Stack spacing={1.5} sx={{ p: 2, pt: 0 }}>
            <StallMap
              stalls={mapItems}
              zones={zones.data ?? []}
              selectedId={editing && editing !== 'new' ? editing.id : null}
              onSelect={(s) => setEditing(visible.find((v) => v.id === s.id) ?? null)}
              describe={(s) => `ล็อค ${s.code} ${zoneById.get(s.zoneId)?.name ?? ''}`.trim()}
            />
            <StallMapLegend zones={zones.data ?? []} statuses={['UNAVAILABLE', 'INACTIVE']} />
            <Typography variant="body2" color="text.secondary">
              คลิกล็อคเพื่อแก้ไขตำแหน่ง/ราคา · "ไม่เปิดจอง" = สงวนไว้ · ลากเพื่อเลื่อนผัง ·
              ล้อเมาส์หรือปุ่ม +/− เพื่อซูม
            </Typography>
          </Stack>
        ) : (
          <Box sx={{ height: 560 }}>
            <DataGrid
              rows={visible}
              columns={columns}
              loading={stalls.isFetching}
              pageSizeOptions={[50, 100]}
              initialState={{ pagination: { paginationModel: { pageSize: 50 } } }}
              disableRowSelectionOnClick
              onRowClick={({ row }) => setEditing(row)}
              sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
            />
          </Box>
        )}
      </Paper>

      {editing && (
        <StallDialog
          stall={editing === 'new' ? null : editing}
          zones={zones.data ?? []}
          defaultZoneId={zoneFilter || zones.data?.[0]?.id || ''}
          onClose={() => setEditing(null)}
          onDone={refresh}
        />
      )}
      {bulkOpen && (
        <BulkDialog
          zones={zones.data ?? []}
          defaultZoneId={zoneFilter || zones.data?.[0]?.id || ''}
          onClose={() => setBulkOpen(false)}
          onDone={refresh}
        />
      )}
    </Stack>
  );
}

/**
 * ช่องตัวเลขที่ใช้กับ `register()` ได้ — ref ต้องไปที่ <input> (inputRef) ไม่ใช่ root ของ TextField
 * ไม่งั้น react-hook-form อ่านค่า/ใช้ setValueAs ไม่ได้
 */
const NumberField = forwardRef<
  HTMLInputElement,
  { label: string; error?: { message?: string }; helperText?: string } & Omit<
    ComponentProps<typeof TextField>,
    'error'
  >
>(function NumberField({ label, error, helperText, ...rest }, ref) {
  return (
    <TextField
      label={label}
      type="number"
      fullWidth
      size="small"
      slotProps={{ htmlInput: { step: 'any' } }}
      error={Boolean(error)}
      helperText={error?.message ?? helperText}
      inputRef={ref}
      {...rest}
    />
  );
});

function StallDialog({
  stall,
  zones,
  defaultZoneId,
  onClose,
  onDone,
}: {
  stall: Stall | null;
  zones: Zone[];
  defaultZoneId: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const form = useForm<z.input<typeof createStallSchema>, unknown, CreateStallInput>({
    resolver: zodResolver(createStallSchema),
    defaultValues: stall
      ? {
          zoneId: stall.zoneId,
          code: stall.code,
          widthM: stall.widthM,
          lengthM: stall.lengthM,
          price: stall.price,
          posX: stall.posX,
          posY: stall.posY,
          rot: stall.rot,
          shapeW: stall.shapeW,
          shapeH: stall.shapeH,
          isActive: stall.isActive,
          isReserved: stall.isReserved,
          note: stall.note ?? '',
        }
      : {
          zoneId: defaultZoneId,
          code: '',
          widthM: 2,
          lengthM: 2,
          price: 100,
          posX: 20,
          posY: 20,
          rot: 0,
          shapeW: 60,
          shapeH: 60,
          isActive: true,
          isReserved: false,
          note: '',
        },
  });
  const { errors } = form.formState;
  const num = { setValueAs: toNumber };

  const save = useMutation({
    mutationFn: (input: CreateStallInput) =>
      stall ? adminApi.stalls.update(stall.id, input) : adminApi.stalls.create(input),
    onSuccess: (s) => {
      onClose();
      onDone(`บันทึกล็อค ${s.code} แล้ว`);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => adminApi.stalls.remove(stall!.id),
    onSuccess: () => {
      onClose();
      onDone(`ลบล็อค ${stall!.code} แล้ว`);
    },
    onError: (e) => {
      setConfirmDelete(false);
      setError(errorMessage(e));
    },
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <DialogTitle>{stall ? `แก้ไขล็อค ${stall.code}` : 'เพิ่มล็อค'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction="row" spacing={2}>
              <TextField
                label="รหัสล็อค"
                fullWidth
                size="small"
                error={Boolean(errors.code)}
                helperText={errors.code?.message ?? 'เช่น A12 (ไม่ซ้ำในตลาด)'}
                {...form.register('code')}
              />
              <Controller
                control={form.control}
                name="zoneId"
                render={({ field }) => (
                  <TextField
                    select
                    label="โซน"
                    fullWidth
                    size="small"
                    {...field}
                    error={Boolean(errors.zoneId)}
                    helperText={errors.zoneId?.message}
                  >
                    {zones.map((z) => (
                      <MenuItem key={z.id} value={z.id}>
                        {z.name}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Stack>
            <Stack direction="row" spacing={2}>
              <NumberField
                label="กว้าง (ม.)"
                error={errors.widthM}
                {...form.register('widthM', num)}
              />
              <NumberField
                label="ยาว (ม.)"
                error={errors.lengthM}
                {...form.register('lengthM', num)}
              />
              <NumberField
                label="ราคา/วัน (บาท)"
                error={errors.price}
                {...form.register('price', num)}
              />
            </Stack>
            <Typography variant="subtitle2">ตำแหน่งบนผัง (px)</Typography>
            <Stack direction="row" spacing={2}>
              <NumberField label="X" error={errors.posX} {...form.register('posX', num)} />
              <NumberField label="Y" error={errors.posY} {...form.register('posY', num)} />
              <NumberField label="หมุน (องศา)" error={errors.rot} {...form.register('rot', num)} />
            </Stack>
            <Stack direction="row" spacing={2}>
              <NumberField
                label="กว้างบนผัง"
                error={errors.shapeW}
                {...form.register('shapeW', num)}
              />
              <NumberField
                label="สูงบนผัง"
                error={errors.shapeH}
                {...form.register('shapeH', num)}
              />
            </Stack>
            <TextField
              label="หมายเหตุ (เห็นเฉพาะผู้ดูแล)"
              fullWidth
              size="small"
              multiline
              minRows={2}
              {...form.register('note')}
            />
            <Stack direction="row" spacing={2}>
              <Controller
                control={form.control}
                name="isReserved"
                render={({ field }) => (
                  <FormControlLabel
                    label="สงวนไว้ (ไม่เปิดจองออนไลน์)"
                    control={
                      <Switch
                        checked={Boolean(field.value)}
                        onChange={(_, v) => field.onChange(v)}
                      />
                    }
                  />
                )}
              />
              <Controller
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormControlLabel
                    label="เปิดใช้งาน"
                    control={
                      <Switch
                        checked={Boolean(field.value)}
                        onChange={(_, v) => field.onChange(v)}
                      />
                    }
                  />
                )}
              />
            </Stack>
            {stall?.hasBookings && (
              <Alert severity="info">
                ล็อคนี้มีประวัติการจอง ลบไม่ได้ — ปิด "เปิดใช้งาน" แทนเพื่อไม่ให้จองได้อีก
              </Alert>
            )}
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          {stall ? (
            <Button
              color="error"
              disabled={stall.hasBookings}
              onClick={() => setConfirmDelete(true)}
            >
              ลบล็อค
            </Button>
          ) : (
            <span />
          )}
          <span>
            <Button onClick={onClose}>ยกเลิก</Button>
            <Button type="submit" variant="contained" loading={save.isPending}>
              บันทึก
            </Button>
          </span>
        </DialogActions>
      </form>
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>ลบล็อค {stall?.code}?</DialogTitle>
        <DialogContent>
          <DialogContentText>ลบแล้วกู้คืนไม่ได้</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>ยกเลิก</Button>
          <Button
            color="error"
            variant="contained"
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            ยืนยันลบ
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

function BulkDialog({
  zones,
  defaultZoneId,
  onClose,
  onDone,
}: {
  zones: Zone[];
  defaultZoneId: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof bulkCreateStallsSchema>, unknown, BulkCreateStallsInput>({
    resolver: zodResolver(bulkCreateStallsSchema),
    defaultValues: {
      zoneId: defaultZoneId,
      prefix: '',
      from: 1,
      to: 10,
      padLength: 0,
      widthM: 2,
      lengthM: 2,
      price: 100,
      shapeW: 60,
      shapeH: 60,
      columns: 10,
      gap: 10,
      originX: 20,
    },
  });
  const { errors } = form.formState;
  const num = { setValueAs: toNumber };

  const [prefix, rawFrom, rawTo, rawPad] = useWatch({
    control: form.control,
    name: ['prefix', 'from', 'to', 'padLength'],
  });
  const preview = (() => {
    // useWatch ได้ค่าดิบจากช่อง input (อาจเป็น string) — แปลงเองก่อนคำนวณตัวอย่าง
    const [from, to, pad] = [rawFrom, rawTo, rawPad].map((v) => toNumber(v) ?? NaN) as [
      number,
      number,
      number,
    ];
    if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return null;
    if (to - from + 1 > MAX_BULK_STALLS) return null;
    const codes = bulkStallCodes({
      prefix: (prefix ?? '').trim().toUpperCase(),
      from,
      to,
      padLength: Number.isInteger(pad) ? Math.min(Math.max(pad, 0), 5) : 0,
    });
    const shown =
      codes.length <= 4 ? codes.join(', ') : `${codes[0]}, ${codes[1]}, … ${codes.at(-1)}`;
    return `${shown} (${codes.length} ล็อค)`;
  })();

  const create = useMutation({
    mutationFn: adminApi.stalls.bulkCreate,
    onSuccess: (r) => {
      onClose();
      onDone(`สร้าง ${r.created} ล็อคแล้ว (${r.codes[0]}–${r.codes.at(-1)})`);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate>
        <DialogTitle>สร้างหลายล็อค</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Controller
              control={form.control}
              name="zoneId"
              render={({ field }) => (
                <TextField select label="โซน" fullWidth size="small" {...field}>
                  {zones.map((z) => (
                    <MenuItem key={z.id} value={z.id}>
                      {z.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label="คำนำหน้า"
                fullWidth
                size="small"
                error={Boolean(errors.prefix)}
                helperText={errors.prefix?.message ?? 'เช่น A'}
                {...form.register('prefix')}
              />
              <NumberField
                label="เลขเริ่มต้น"
                error={errors.from}
                {...form.register('from', num)}
              />
              <NumberField label="เลขสิ้นสุด" error={errors.to} {...form.register('to', num)} />
              <NumberField
                label="จำนวนหลัก"
                error={errors.padLength}
                helperText="2 → A01"
                {...form.register('padLength', num)}
              />
            </Stack>
            <Alert severity={preview ? 'info' : 'warning'} icon={false}>
              {preview
                ? `จะสร้าง: ${preview}`
                : `ช่วงเลขไม่ถูกต้อง (สร้างได้ครั้งละไม่เกิน ${MAX_BULK_STALLS} ล็อค)`}
            </Alert>
            <Stack direction="row" spacing={2}>
              <NumberField
                label="กว้าง (ม.)"
                error={errors.widthM}
                {...form.register('widthM', num)}
              />
              <NumberField
                label="ยาว (ม.)"
                error={errors.lengthM}
                {...form.register('lengthM', num)}
              />
              <NumberField
                label="ราคา/วัน (บาท)"
                error={errors.price}
                {...form.register('price', num)}
              />
            </Stack>
            <Typography variant="subtitle2">การวางบนผัง</Typography>
            <Stack direction="row" spacing={2}>
              <NumberField
                label="จำนวนต่อแถว"
                error={errors.columns}
                {...form.register('columns', num)}
              />
              <NumberField
                label="ระยะห่าง (px)"
                error={errors.gap}
                {...form.register('gap', num)}
              />
              <NumberField
                label="กว้างบนผัง"
                error={errors.shapeW}
                {...form.register('shapeW', num)}
              />
              <NumberField
                label="สูงบนผัง"
                error={errors.shapeH}
                {...form.register('shapeH', num)}
              />
            </Stack>
            <Stack direction="row" spacing={2}>
              <NumberField
                label="เริ่มที่ X"
                error={errors.originX}
                {...form.register('originX', num)}
              />
              <NumberField
                label="เริ่มที่ Y"
                error={errors.originY}
                helperText="ว่าง = วางต่อใต้ล็อคที่มีอยู่"
                {...form.register('originY', num)}
              />
            </Stack>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button type="submit" variant="contained" loading={create.isPending}>
            สร้างล็อค
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
