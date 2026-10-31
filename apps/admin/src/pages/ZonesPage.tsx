import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { createProductCategorySchema, createZoneSchema } from '@market-booking/shared';
import type {
  CreateProductCategoryInput,
  CreateZoneInput,
  ProductCategory,
  Zone,
} from '@market-booking/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import FormLabel from '@mui/material/FormLabel';
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

type Notice = { severity: 'success' | 'error'; text: string } | null;

/** ตั้งค่าโซน (สี + ประเภทสินค้าที่ขายได้) และรายการประเภทสินค้า */
export function ZonesPage() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<Notice>(null);
  const [zoneDialog, setZoneDialog] = useState<Zone | 'new' | null>(null);
  const [categoryDialog, setCategoryDialog] = useState<ProductCategory | 'new' | null>(null);

  const zones = useQuery({ queryKey: ['zones'], queryFn: adminApi.zones.list });
  const categories = useQuery({ queryKey: ['categories'], queryFn: adminApi.categories.list });
  const categoryName = new Map(categories.data?.map((c) => [c.id, c.name]));

  const refresh = (text: string) => {
    setNotice({ severity: 'success', text });
    void queryClient.invalidateQueries({ queryKey: ['zones'] });
    void queryClient.invalidateQueries({ queryKey: ['categories'] });
  };

  const removeZone = useMutation({
    mutationFn: (z: Zone) => adminApi.zones.remove(z.id).then(() => z),
    onSuccess: (z) => refresh(`ลบโซน ${z.name} แล้ว`),
    onError: (e) => setNotice({ severity: 'error', text: errorMessage(e) }),
  });
  const removeCategory = useMutation({
    mutationFn: (c: ProductCategory) => adminApi.categories.remove(c.id).then(() => c),
    onSuccess: (c) => refresh(`ลบประเภท ${c.name} แล้ว`),
    onError: (e) => setNotice({ severity: 'error', text: errorMessage(e) }),
  });

  return (
    <Stack spacing={2}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        โซนและประเภทสินค้า
      </Typography>
      {notice && (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      <Paper variant="outlined">
        <Stack direction="row" sx={{ p: 2, justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">โซน</Typography>
          <Button variant="contained" onClick={() => setZoneDialog('new')}>
            เพิ่มโซน
          </Button>
        </Stack>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="รายการโซน">
            <TableHead>
              <TableRow>
                <TableCell>ชื่อโซน</TableCell>
                <TableCell>ประเภทสินค้าที่ขายได้</TableCell>
                <TableCell align="right">จำนวนล็อค</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {zones.data?.map((z) => (
                <TableRow key={z.id}>
                  <TableCell>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Box
                        aria-hidden
                        sx={{ width: 16, height: 16, borderRadius: 1, bgcolor: z.color }}
                      />
                      <span>{z.name}</span>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    {z.allowedCategoryIds.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        ทุกประเภท
                      </Typography>
                    ) : (
                      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                        {z.allowedCategoryIds.map((id) => (
                          <Chip key={id} size="small" label={categoryName.get(id) ?? '—'} />
                        ))}
                      </Stack>
                    )}
                  </TableCell>
                  <TableCell align="right">{z.stallCount}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Button size="small" onClick={() => setZoneDialog(z)}>
                      แก้ไข
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      disabled={z.stallCount > 0}
                      title={z.stallCount > 0 ? 'ย้ายหรือลบล็อคในโซนนี้ก่อน' : undefined}
                      onClick={() => removeZone.mutate(z)}
                    >
                      ลบ
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {zones.data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>ยังไม่มีโซน</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </Paper>

      <Paper variant="outlined">
        <Stack direction="row" sx={{ p: 2, justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">ประเภทสินค้า</Typography>
          <Button variant="contained" onClick={() => setCategoryDialog('new')}>
            เพิ่มประเภทสินค้า
          </Button>
        </Stack>
        <Table size="small" aria-label="รายการประเภทสินค้า">
          <TableHead>
            <TableRow>
              <TableCell>ชื่อ</TableCell>
              <TableCell align="right">ลำดับ</TableCell>
              <TableCell align="right">ผู้ค้าที่เลือก</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {categories.data?.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.name}</TableCell>
                <TableCell align="right">{c.sortOrder}</TableCell>
                <TableCell align="right">{c.vendorCount}</TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <Button size="small" onClick={() => setCategoryDialog(c)}>
                    แก้ไข
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    disabled={c.vendorCount > 0}
                    title={c.vendorCount > 0 ? 'มีผู้ค้าเลือกประเภทนี้อยู่' : undefined}
                    onClick={() => removeCategory.mutate(c)}
                  >
                    ลบ
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {zoneDialog && (
        <ZoneDialog
          zone={zoneDialog === 'new' ? null : zoneDialog}
          categories={categories.data ?? []}
          onClose={() => setZoneDialog(null)}
          onSaved={(z) => refresh(`บันทึกโซน ${z.name} แล้ว`)}
        />
      )}
      {categoryDialog && (
        <CategoryDialog
          category={categoryDialog === 'new' ? null : categoryDialog}
          onClose={() => setCategoryDialog(null)}
          onSaved={(c) => refresh(`บันทึกประเภท ${c.name} แล้ว`)}
        />
      )}
    </Stack>
  );
}

function ZoneDialog({
  zone,
  categories,
  onClose,
  onSaved,
}: {
  zone: Zone | null;
  categories: ProductCategory[];
  onClose: () => void;
  onSaved: (z: Zone) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof createZoneSchema>, unknown, CreateZoneInput>({
    resolver: zodResolver(createZoneSchema),
    defaultValues: {
      name: zone?.name ?? '',
      color: zone?.color ?? '#3B82F6',
      allowedCategoryIds: zone?.allowedCategoryIds ?? [],
      sortOrder: zone?.sortOrder,
    },
  });
  const { errors } = form.formState;
  const save = useMutation({
    mutationFn: (input: CreateZoneInput) =>
      zone ? adminApi.zones.update(zone.id, input) : adminApi.zones.create(input),
    onSuccess: (z) => {
      onClose();
      onSaved(z);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <DialogTitle>{zone ? `แก้ไขโซน ${zone.name}` : 'เพิ่มโซน'}</DialogTitle>
        <DialogContent>
          <TextField
            label="ชื่อโซน"
            fullWidth
            margin="normal"
            error={Boolean(errors.name)}
            helperText={errors.name?.message}
            {...form.register('name')}
          />
          <Controller
            control={form.control}
            name="color"
            render={({ field }) => (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', mt: 2, mb: 1 }}>
                <input
                  type="color"
                  aria-label="เลือกสี"
                  value={/^#[0-9A-Fa-f]{6}$/.test(field.value) ? field.value : '#000000'}
                  onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                  style={{ width: 48, height: 40, border: 0, padding: 0, background: 'none' }}
                />
                <TextField
                  label="สี (#RRGGBB)"
                  fullWidth
                  size="small"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={Boolean(errors.color)}
                  helperText={errors.color?.message}
                />
              </Stack>
            )}
          />
          <TextField
            label="ลำดับการแสดง"
            type="number"
            fullWidth
            margin="normal"
            error={Boolean(errors.sortOrder)}
            helperText={errors.sortOrder?.message ?? 'ไม่ระบุ = ต่อท้าย'}
            {...form.register('sortOrder', {
              setValueAs: (v: string | number | undefined) =>
                v === '' || v === undefined ? undefined : Number(v),
            })}
          />
          <Controller
            control={form.control}
            name="allowedCategoryIds"
            render={({ field: { value = [], onChange } }) => (
              <Box sx={{ mt: 2 }}>
                <FormLabel component="legend">
                  ประเภทสินค้าที่ขายได้ (ไม่เลือก = ทุกประเภท)
                </FormLabel>
                <FormGroup>
                  {categories.map((c) => (
                    <FormControlLabel
                      key={c.id}
                      label={c.name}
                      control={
                        <Checkbox
                          checked={value.includes(c.id)}
                          onChange={(e) =>
                            onChange(
                              e.target.checked
                                ? [...value, c.id]
                                : value.filter((id) => id !== c.id),
                            )
                          }
                        />
                      }
                    />
                  ))}
                </FormGroup>
              </Box>
            )}
          />
          {error && <Alert severity="error">{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button type="submit" variant="contained" loading={save.isPending}>
            บันทึก
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function CategoryDialog({
  category,
  onClose,
  onSaved,
}: {
  category: ProductCategory | null;
  onClose: () => void;
  onSaved: (c: ProductCategory) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<
    z.input<typeof createProductCategorySchema>,
    unknown,
    CreateProductCategoryInput
  >({
    resolver: zodResolver(createProductCategorySchema),
    defaultValues: { name: category?.name ?? '', sortOrder: category?.sortOrder },
  });
  const { errors } = form.formState;
  const save = useMutation({
    mutationFn: (input: CreateProductCategoryInput) =>
      category ? adminApi.categories.update(category.id, input) : adminApi.categories.create(input),
    onSuccess: (c) => {
      onClose();
      onSaved(c);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <DialogTitle>{category ? `แก้ไขประเภท ${category.name}` : 'เพิ่มประเภทสินค้า'}</DialogTitle>
        <DialogContent>
          <TextField
            label="ชื่อประเภทสินค้า"
            fullWidth
            margin="normal"
            error={Boolean(errors.name)}
            helperText={errors.name?.message}
            {...form.register('name')}
          />
          <TextField
            label="ลำดับการแสดง"
            type="number"
            fullWidth
            margin="normal"
            error={Boolean(errors.sortOrder)}
            helperText={errors.sortOrder?.message ?? 'ไม่ระบุ = ต่อท้าย'}
            {...form.register('sortOrder', {
              setValueAs: (v: string | number | undefined) =>
                v === '' || v === undefined ? undefined : Number(v),
            })}
          />
          {error && <Alert severity="error">{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button type="submit" variant="contained" loading={save.isPending}>
            บันทึก
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
