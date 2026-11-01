import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { SETTING_DEFAULTS, settingsSchema } from '@market-booking/shared';
import type { SettingKey, Settings, UpdateSettingsInput } from '@market-booking/shared';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { z } from 'zod';
import { adminApi } from '../api/admin';
import { errorMessage } from '../lib/errors';

interface FieldMeta {
  label: string;
  help?: string;
  unit?: string;
}

/** ชื่อ/คำอธิบายภาษาไทยของแต่ละ key — ชนิดข้อมูลและช่วงค่ามาจาก settingFields (packages/shared) */
const META: Record<SettingKey, FieldMeta> = {
  registration_mode: {
    label: 'อนุมัติสมาชิกอัตโนมัติ',
    help: 'ปิด = เจ้าหน้าที่ต้องตรวจก่อนอนุมัติ · เปิดแล้วผู้ค้าที่รออยู่เดิมไม่ถูกอนุมัติตาม (ใช้ปุ่ม "อนุมัติทั้งหมดที่ค้าง")',
  },
  require_id_card_image: { label: 'บังคับแนบรูปบัตรประชาชนตอนสมัคร' },
  require_shop_image: { label: 'บังคับแนบรูปร้าน/สินค้าตอนสมัคร' },
  hold_minutes: { label: 'เวลาให้กดยืนยันหลังเลือกล็อค', unit: 'นาที', help: '1–60' },
  max_stalls_per_vendor_default: {
    label: 'จำนวนล็อคสูงสุดต่อผู้ค้าต่อวัน (ค่าเริ่มต้นของรอบใหม่)',
    unit: 'ล็อค',
    help: '1–50',
  },
  cancel_before_hours: {
    label: 'ผู้ค้ายกเลิกเองได้ก่อนวันขายอย่างน้อย',
    unit: 'ชั่วโมง',
    help: '0–720',
  },
  payment_required: { label: 'ต้องชำระเงินหลังยืนยันการจอง' },
  payment_deadline_minutes: {
    label: 'เวลาชำระเงินหลังยืนยัน',
    unit: 'นาที',
    help: '5–10080 (7 วัน)',
  },
  promptpay_id: {
    label: 'PromptPay สำหรับสร้าง QR',
    help: 'เบอร์มือถือ / เลขบัตรประชาชน / เลขผู้เสียภาษี — เว้นว่าง = ยังไม่ตั้ง',
  },
  waitlist_claim_minutes: {
    label: 'เวลาให้ผู้ที่ต่อคิวยืนยันสิทธิ์',
    unit: 'นาที',
    help: '1–1440',
  },
  noshow_threshold: { label: 'ไม่มาขายกี่ครั้งจึงระงับสิทธิ์', unit: 'ครั้ง', help: '1–20' },
  noshow_suspend_days: { label: 'ระยะเวลาระงับสิทธิ์', unit: 'วัน', help: '1–365' },
  notify_before_round_open_minutes: {
    label: 'แจ้งเตือนก่อนรอบเปิดจอง',
    unit: 'นาที',
    help: '0 = ไม่แจ้ง',
  },
  notify_before_payment_due_minutes: {
    label: 'เตือนผู้ค้าก่อนหมดเวลาชำระ',
    unit: 'นาที',
    help: '0 = ไม่เตือน',
  },
  line_admin_group_id: {
    label: 'LINE กลุ่มเจ้าหน้าที่ (group ID)',
    help: 'เชิญบอทของ LINE OA เข้ากลุ่ม แล้วบอทจะตอบ group ID — เว้นว่าง = ไม่แจ้งกลุ่ม',
  },
};

const GROUPS: { title: string; keys: SettingKey[] }[] = [
  {
    title: 'การสมัครสมาชิก',
    keys: ['registration_mode', 'require_id_card_image', 'require_shop_image'],
  },
  {
    title: 'การจอง',
    keys: ['hold_minutes', 'max_stalls_per_vendor_default', 'cancel_before_hours'],
  },
  { title: 'การชำระเงิน', keys: ['payment_required', 'payment_deadline_minutes', 'promptpay_id'] },
  {
    title: 'คิวรอ / ไม่มาขาย / แจ้งเตือน',
    keys: [
      'waitlist_claim_minutes',
      'noshow_threshold',
      'noshow_suspend_days',
      'notify_before_round_open_minutes',
      'notify_before_payment_due_minutes',
      'line_admin_group_id',
    ],
  },
];

type FormValues = z.input<typeof settingsSchema>;

export function SettingsPage() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: adminApi.settings.get });
  return (
    <Stack spacing={2} sx={{ maxWidth: 720 }}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        ตั้งค่าระบบ
      </Typography>
      {settings.isPending && <CircularProgress />}
      {settings.isError && <Alert severity="error">{errorMessage(settings.error)}</Alert>}
      {settings.data && <SettingsForm initial={settings.data} />}
    </Stack>
  );
}

function SettingsForm({ initial }: { initial: Settings }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ severity: 'success' | 'error'; text: string } | null>(
    null,
  );
  const form = useForm<FormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: initial,
  });
  const { errors, dirtyFields, isDirty } = form.formState;

  useEffect(() => form.reset(initial), [form, initial]);

  const save = useMutation({
    mutationFn: adminApi.settings.update,
    onSuccess: (saved) => {
      queryClient.setQueryData(['settings'], saved);
      form.reset(saved);
      setNotice({ severity: 'success', text: 'บันทึกการตั้งค่าแล้ว' });
    },
    onError: (e) => setNotice({ severity: 'error', text: errorMessage(e) }),
  });

  const submit = form.handleSubmit((values) => {
    setNotice(null);
    // ส่งเฉพาะ key ที่แก้ — ไม่ทับค่าที่ admin คนอื่นเพิ่งเปลี่ยน
    const changed = Object.fromEntries(
      (Object.keys(dirtyFields) as SettingKey[]).map((k) => [k, (values as Settings)[k]]),
    ) as UpdateSettingsInput;
    save.mutate(changed);
  });

  function field(key: SettingKey) {
    const meta = META[key];
    const kind = typeof SETTING_DEFAULTS[key];

    if (key === 'registration_mode') {
      return (
        <Controller
          key={key}
          name={key}
          control={form.control}
          render={({ field: f }) => (
            <Stack>
              <FormControlLabel
                control={
                  <Switch
                    checked={f.value === 'AUTO'}
                    onChange={(e) => f.onChange(e.target.checked ? 'AUTO' : 'MANUAL')}
                  />
                }
                label={<Typography sx={{ fontWeight: 600 }}>{meta.label}</Typography>}
              />
              <Typography variant="body2" color="text.secondary">
                {meta.help}
              </Typography>
            </Stack>
          )}
        />
      );
    }
    if (kind === 'boolean') {
      return (
        <Controller
          key={key}
          name={key}
          control={form.control}
          render={({ field: f }) => (
            <FormControlLabel
              control={
                <Switch checked={Boolean(f.value)} onChange={(e) => f.onChange(e.target.checked)} />
              }
              label={meta.label}
            />
          )}
        />
      );
    }
    if (kind === 'number') {
      return (
        <TextField
          key={key}
          label={meta.label}
          type="number"
          error={Boolean(errors[key])}
          helperText={errors[key]?.message ?? meta.help}
          slotProps={{
            input: {
              endAdornment: meta.unit && (
                <InputAdornment position="end">{meta.unit}</InputAdornment>
              ),
            },
          }}
          {...form.register(key, { valueAsNumber: true })}
        />
      );
    }
    // promptpay_id, line_admin_group_id (string | null): ช่องว่าง = null
    return (
      <TextField
        key={key}
        label={meta.label}
        error={Boolean(errors[key])}
        helperText={errors[key]?.message ?? meta.help}
        {...form.register(key, {
          setValueAs: (v: string | null) => (v === null || v.trim() === '' ? null : v),
        })}
      />
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <Stack spacing={2}>
        {GROUPS.map((group) => (
          <Paper key={group.title} variant="outlined" sx={{ p: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }} gutterBottom>
              {group.title}
            </Typography>
            <Stack spacing={2}>{group.keys.map(field)}</Stack>
          </Paper>
        ))}
        {notice && <Alert severity={notice.severity}>{notice.text}</Alert>}
        <Stack direction="row" spacing={1}>
          <Button type="submit" variant="contained" disabled={!isDirty} loading={save.isPending}>
            บันทึก
          </Button>
          <Button disabled={!isDirty} onClick={() => form.reset(initial)}>
            ยกเลิกการแก้ไข
          </Button>
        </Stack>
      </Stack>
    </form>
  );
}
