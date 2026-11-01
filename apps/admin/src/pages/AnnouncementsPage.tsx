import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ANNOUNCEMENT_STATE_TH,
  createAnnouncementSchema,
  type AdminAnnouncement,
  type CreateAnnouncementInput,
  type UpdateAnnouncementInput,
} from '@market-booking/shared';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { adminApi } from '../api/admin';
import { errorMessage } from '../lib/errors';
import { formatDateTime, fromBangkokInput, toBangkokInput } from '../lib/format';

/** ช่อง datetime-local (เวลาไทย) → ISO แล้วตรวจด้วย schema เดียวกับ API */
const formFields = z.object({
  title: z.string(),
  body: z.string(),
  publishAt: z.string().transform(fromBangkokInput),
  expireAt: z.string().transform((v) => (v ? fromBangkokInput(v) : null)),
  isPinned: z.boolean(),
  broadcastLine: z.boolean(),
});
// ช่องที่มี default ใน schema กลางรับ undefined ได้ แต่ฟอร์มส่งครบทุกช่องเสมอ
const formSchema = formFields.pipe(
  createAnnouncementSchema as unknown as z.ZodType<
    CreateAnnouncementInput,
    z.output<typeof formFields>
  >,
);
type Form = z.input<typeof formSchema>;

const STATE_COLOR = { SCHEDULED: 'info', ACTIVE: 'success', EXPIRED: 'default' } as const;

function AnnouncementDialog({
  announcement: a,
  onClose,
  onSaved,
}: {
  announcement: AdminAnnouncement | null;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Form, unknown, CreateAnnouncementInput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: a?.title ?? '',
      body: a?.body ?? '',
      publishAt: toBangkokInput(a?.publishAt ?? new Date().toISOString()),
      expireAt: a?.expireAt ? toBangkokInput(a.expireAt) : '',
      isPinned: a?.isPinned ?? false,
      broadcastLine: a?.broadcastLine ?? false,
    },
  });
  const { errors, dirtyFields } = form.formState;
  const sent = Boolean(a?.broadcastedAt);

  const save = useMutation({
    mutationFn: (input: CreateAnnouncementInput) => {
      if (!a) return adminApi.announcements.create(input);
      // ส่งเฉพาะช่องที่แก้ (ช่องเวลาละเอียดแค่นาที — ส่งค่าเดิมกลับไปจะเลื่อนวินาที)
      const patch: UpdateAnnouncementInput = {};
      for (const key of Object.keys(dirtyFields) as (keyof CreateAnnouncementInput)[]) {
        Object.assign(patch, { [key]: input[key] });
      }
      return Object.keys(patch).length > 0
        ? adminApi.announcements.update(a.id, patch)
        : Promise.resolve(a);
    },
    onSuccess: (saved) => {
      onClose();
      onSaved(a ? `บันทึกประกาศ "${saved.title}" แล้ว` : `สร้างประกาศ "${saved.title}" แล้ว`);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <DialogTitle>{a ? 'แก้ไขประกาศ' : 'สร้างประกาศ'}</DialogTitle>
        <DialogContent>
          <TextField
            label="หัวข้อ"
            fullWidth
            margin="normal"
            error={Boolean(errors.title)}
            helperText={errors.title?.message}
            {...form.register('title')}
          />
          <TextField
            label="รายละเอียด"
            fullWidth
            multiline
            minRows={4}
            margin="normal"
            error={Boolean(errors.body)}
            helperText={errors.body?.message ?? 'ขึ้นบรรทัดใหม่ได้ — ผู้ค้าเห็นตามที่พิมพ์'}
            {...form.register('body')}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="เริ่มแสดง (เวลาไทย)"
              type="datetime-local"
              fullWidth
              margin="normal"
              error={Boolean(errors.publishAt)}
              helperText={errors.publishAt?.message}
              slotProps={{ inputLabel: { shrink: true } }}
              {...form.register('publishAt')}
            />
            <TextField
              label="หยุดแสดง (ไม่บังคับ)"
              type="datetime-local"
              fullWidth
              margin="normal"
              error={Boolean(errors.expireAt)}
              helperText={errors.expireAt?.message ?? 'เว้นว่าง = แสดงจนกว่าจะลบ'}
              slotProps={{ inputLabel: { shrink: true } }}
              {...form.register('expireAt')}
            />
          </Stack>
          <Controller
            name="isPinned"
            control={form.control}
            render={({ field }) => (
              <FormControlLabel
                control={
                  <Switch
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                  />
                }
                label="ปักหมุด (แสดงบนสุด)"
              />
            )}
          />
          <Controller
            name="broadcastLine"
            control={form.control}
            render={({ field }) => (
              <FormControlLabel
                disabled={sent}
                control={
                  <Checkbox
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                  />
                }
                label={
                  sent
                    ? `ส่ง LINE แล้วเมื่อ ${formatDateTime(a!.broadcastedAt)}`
                    : 'ส่ง LINE ถึงผู้ค้าทุกคนที่เชื่อม LINE เมื่อถึงเวลาเริ่มแสดง (ครั้งเดียว)'
                }
              />
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

/** ประกาศของตลาด (Phase 9.3) — ผู้ค้าเห็นที่หน้าแรกของแอปผู้ค้า */
export function AnnouncementsPage() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['announcements'], queryFn: adminApi.announcements.list });
  const [editing, setEditing] = useState<AdminAnnouncement | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdminAnnouncement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = (text: string) => {
    setNotice(text);
    void queryClient.invalidateQueries({ queryKey: ['announcements'] });
  };
  const remove = useMutation({
    mutationFn: (a: AdminAnnouncement) => adminApi.announcements.remove(a.id),
    onSuccess: (_, a) => {
      setDeleting(null);
      refresh(`ลบประกาศ "${a.title}" แล้ว`);
    },
  });

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
          ประกาศ
        </Typography>
        <Button variant="contained" onClick={() => setEditing('new')}>
          สร้างประกาศ
        </Button>
      </Stack>
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {list.isPending && <LinearProgress />}
      {list.isError && <Alert severity="error">{errorMessage(list.error)}</Alert>}
      {list.data?.length === 0 && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography color="text.secondary">
            ยังไม่มีประกาศ — ประกาศจะแสดงที่หน้าแรกของแอปผู้ค้าตามช่วงเวลาที่ตั้ง
          </Typography>
        </Paper>
      )}
      <Stack spacing={1.5} role="list" aria-label="ประกาศ">
        {list.data?.map((a) => (
          <Paper key={a.id} variant="outlined" sx={{ p: 2 }} role="listitem" aria-label={a.title}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ justifyContent: 'space-between' }}
            >
              <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  useFlexGap
                >
                  <Typography sx={{ fontWeight: 700 }}>{a.title}</Typography>
                  <Chip
                    size="small"
                    label={ANNOUNCEMENT_STATE_TH[a.state]}
                    color={STATE_COLOR[a.state]}
                  />
                  {a.isPinned && <Chip size="small" label="ปักหมุด" color="warning" />}
                  {a.broadcastLine && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={a.broadcastedAt ? 'ส่ง LINE แล้ว' : 'รอส่ง LINE'}
                    />
                  )}
                </Stack>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}
                >
                  {a.body.length > 240 ? `${a.body.slice(0, 240)}…` : a.body}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  แสดง {formatDateTime(a.publishAt)}
                  {a.expireAt ? ` – ${formatDateTime(a.expireAt)}` : ' เป็นต้นไป'}
                </Typography>
              </Stack>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                <Button size="small" onClick={() => setEditing(a)}>
                  แก้ไข
                </Button>
                <Button size="small" color="error" onClick={() => setDeleting(a)}>
                  ลบ
                </Button>
              </Stack>
            </Stack>
          </Paper>
        ))}
      </Stack>

      {editing && (
        <AnnouncementDialog
          announcement={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      <Dialog open={Boolean(deleting)} onClose={() => setDeleting(null)}>
        <DialogTitle>ลบประกาศ</DialogTitle>
        <DialogContent>
          <DialogContentText>
            ลบ "{deleting?.title}"? ผู้ค้าจะไม่เห็นประกาศนี้อีก (LINE ที่ส่งไปแล้วดึงกลับไม่ได้)
          </DialogContentText>
          {remove.isError && <Alert severity="error">{errorMessage(remove.error)}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>ยกเลิก</Button>
          <Button
            color="error"
            variant="contained"
            loading={remove.isPending}
            onClick={() => deleting && remove.mutate(deleting)}
          >
            ลบ
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
