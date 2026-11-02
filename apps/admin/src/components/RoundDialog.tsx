import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { createRoundSchema } from '@market-booking/shared';
import type { CreateRoundInput, RoundDetail, UpdateRoundInput } from '@market-booking/shared';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { adminApi } from '../api/admin';
import { errorMessage } from '../lib/errors';
import { fromBangkokInput, toBangkokInput } from '../lib/format';

/** ช่อง datetime-local (เวลาไทย) → ISO แล้วตรวจด้วย schema เดียวกับ API */
const roundFormSchema = z
  .object({
    name: z.string(),
    openAt: z.string().transform(fromBangkokInput),
    closeAt: z.string().transform(fromBangkokInput),
    maxStallsPerVendor: z.number().optional(),
    waitingRoomCapacity: z.number().nullable().optional(),
  })
  .pipe(createRoundSchema);
type RoundForm = z.input<typeof roundFormSchema>;

const toNumber = (v: unknown) =>
  v === '' || v === null || v === undefined ? undefined : Number(v);
/** ช่องว่าง = ไม่ใช้ Waiting Room */
const toNullableNumber = (v: unknown) =>
  v === '' || v === null || v === undefined ? null : Number(v);

/** สร้าง/แก้รอบ — รอบที่เปิดจองแล้วแก้เวลาเปิดไม่ได้ (§8.3) */
export function RoundDialog({
  round,
  onClose,
  onSaved,
}: {
  round: RoundDetail | null;
  onClose: () => void;
  onSaved: (round: RoundDetail) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const openLocked = round?.status === 'PUBLISHED' && round.phase !== 'UPCOMING';
  const form = useForm<RoundForm, unknown, CreateRoundInput>({
    resolver: zodResolver(roundFormSchema),
    defaultValues: {
      name: round?.name ?? '',
      openAt: round ? toBangkokInput(round.openAt) : '',
      closeAt: round ? toBangkokInput(round.closeAt) : '',
      maxStallsPerVendor: round?.maxStallsPerVendor,
      waitingRoomCapacity: round?.waitingRoomCapacity ?? null,
    },
  });
  const { errors, dirtyFields } = form.formState;

  const save = useMutation({
    mutationFn: (input: CreateRoundInput) => {
      if (!round) return adminApi.rounds.create(input);
      // ส่งเฉพาะช่องที่แก้ — ช่องเวลาละเอียดแค่นาที ส่งค่าเดิมกลับไปจะกลายเป็น "แก้เวลา"
      const patch: UpdateRoundInput = {};
      if (dirtyFields.name) patch.name = input.name;
      if (dirtyFields.openAt) patch.openAt = input.openAt;
      if (dirtyFields.closeAt) patch.closeAt = input.closeAt;
      if (dirtyFields.maxStallsPerVendor && input.maxStallsPerVendor !== undefined) {
        patch.maxStallsPerVendor = input.maxStallsPerVendor;
      }
      if (dirtyFields.waitingRoomCapacity) patch.waitingRoomCapacity = input.waitingRoomCapacity;
      return Object.keys(patch).length > 0
        ? adminApi.rounds.update(round.id, patch)
        : Promise.resolve(round);
    },
    onSuccess: (r) => {
      onClose();
      onSaved(r);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const timeField = (name: 'openAt' | 'closeAt', label: string, readOnly = false) => (
    <TextField
      label={label}
      type="datetime-local"
      fullWidth
      margin="normal"
      error={Boolean(errors[name])}
      helperText={
        errors[name]?.message ?? (readOnly ? 'รอบนี้เปิดจองแล้ว แก้เวลาเปิดไม่ได้' : undefined)
      }
      slotProps={{ inputLabel: { shrink: true }, htmlInput: { readOnly } }}
      {...form.register(name)}
    />
  );

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <DialogTitle>{round ? `แก้ไขรอบ ${round.name}` : 'สร้างรอบการจอง'}</DialogTitle>
        <DialogContent>
          <TextField
            label="ชื่อรอบ"
            placeholder="เช่น รอบเดือนธันวาคม 2569"
            fullWidth
            margin="normal"
            error={Boolean(errors.name)}
            helperText={errors.name?.message}
            {...form.register('name')}
          />
          {timeField('openAt', 'เปิดจอง (เวลาไทย)', openLocked)}
          {timeField('closeAt', 'ปิดจอง (เวลาไทย)')}
          <TextField
            label="จำนวนล็อคสูงสุดต่อผู้ค้าต่อวัน"
            type="number"
            fullWidth
            margin="normal"
            error={Boolean(errors.maxStallsPerVendor)}
            helperText={
              errors.maxStallsPerVendor?.message ??
              (round ? undefined : 'ไม่ระบุ = ใช้ค่าจากตั้งค่าระบบ')
            }
            {...form.register('maxStallsPerVendor', { setValueAs: toNumber })}
          />
          <TextField
            label="Waiting Room: จำนวนคนในหน้าจองพร้อมกัน"
            type="number"
            fullWidth
            margin="normal"
            error={Boolean(errors.waitingRoomCapacity)}
            helperText={
              errors.waitingRoomCapacity?.message ??
              'เว้นว่าง = ไม่ใช้คิว · ใส่ตัวเลขเมื่อคาดว่าคนจองพร้อมกันมาก (เช่น 100) — คนที่เหลือรอคิวและเข้าเป็นชุด'
            }
            {...form.register('waitingRoomCapacity', { setValueAs: toNullableNumber })}
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
