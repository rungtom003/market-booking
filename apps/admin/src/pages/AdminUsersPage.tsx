import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { AdminRole, createAdminUserSchema } from '@market-booking/shared';
import type { AdminUser, CreateAdminUserInput } from '@market-booking/shared';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DataGrid } from '@mui/x-data-grid';
import type { GridColDef, GridPaginationModel } from '@mui/x-data-grid';
import { adminApi } from '../api/admin';
import { errorMessage } from '../lib/errors';
import { ADMIN_ROLE_TH, formatDateTime } from '../lib/format';
import { useAdmin } from '../lib/session';

const ROLES = Object.values(AdminRole);

/** จัดการบัญชีผู้ดูแล (SUPER_ADMIN) — ไม่มีการลบ ใช้ปิดบัญชีแทน (Decision Log) */
export function AdminUsersPage() {
  const me = useAdmin();
  const queryClient = useQueryClient();
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 20 });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [notice, setNotice] = useState<{ severity: 'success' | 'error'; text: string } | null>(
    null,
  );

  const list = useQuery({
    queryKey: ['admin-users', pagination],
    queryFn: () =>
      adminApi.users.list({ page: pagination.page + 1, pageSize: pagination.pageSize }),
    placeholderData: keepPreviousData,
  });
  const done = (text: string) => {
    setNotice({ severity: 'success', text });
    void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
  };

  const columns: GridColDef<AdminUser>[] = [
    { field: 'username', headerName: 'ชื่อผู้ใช้', flex: 1, minWidth: 140 },
    { field: 'displayName', headerName: 'ชื่อที่แสดง', flex: 1, minWidth: 140 },
    {
      field: 'role',
      headerName: 'บทบาท',
      width: 130,
      valueFormatter: (v: AdminRole) => ADMIN_ROLE_TH[v],
    },
    {
      field: 'isActive',
      headerName: 'สถานะ',
      width: 110,
      renderCell: ({ value }) => (
        <Chip
          size="small"
          label={value ? 'ใช้งาน' : 'ปิดแล้ว'}
          color={value ? 'success' : 'default'}
        />
      ),
    },
    {
      field: 'lastLoginAt',
      headerName: 'เข้าระบบล่าสุด',
      width: 170,
      valueFormatter: (v: string | null) => formatDateTime(v),
    },
  ];

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          ผู้ดูแลระบบ
        </Typography>
        <Button variant="contained" onClick={() => setCreating(true)}>
          เพิ่มผู้ดูแล
        </Button>
      </Stack>
      {notice && (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
      <Paper variant="outlined" sx={{ height: 520 }}>
        <DataGrid
          rows={list.data?.data ?? []}
          rowCount={list.data?.meta?.total ?? 0}
          columns={columns}
          loading={list.isFetching}
          paginationMode="server"
          paginationModel={pagination}
          onPaginationModelChange={setPagination}
          pageSizeOptions={[20, 50]}
          disableRowSelectionOnClick
          onRowClick={({ row }) => setEditing(row)}
          sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        />
      </Paper>
      <CreateDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(u) => done(`เพิ่ม ${u.username} แล้ว`)}
      />
      {editing && (
        <EditDialog
          user={editing}
          isSelf={editing.id === me.id}
          onClose={() => setEditing(null)}
          onSaved={(u) => done(`บันทึก ${u.username} แล้ว`)}
        />
      )}
    </Stack>
  );
}

function CreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (u: AdminUser) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CreateAdminUserInput>({
    resolver: zodResolver(createAdminUserSchema),
    defaultValues: { role: 'STAFF', username: '', password: '', displayName: '' },
  });
  const { errors } = form.formState;
  const create = useMutation({
    mutationFn: adminApi.users.create,
    onSuccess: (u) => {
      form.reset();
      onClose();
      onCreated(u);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate>
        <DialogTitle>เพิ่มผู้ดูแล</DialogTitle>
        <DialogContent>
          <TextField
            label="ชื่อผู้ใช้"
            fullWidth
            margin="normal"
            error={Boolean(errors.username)}
            helperText={errors.username?.message}
            {...form.register('username')}
          />
          <TextField
            label="ชื่อที่แสดง"
            fullWidth
            margin="normal"
            error={Boolean(errors.displayName)}
            helperText={errors.displayName?.message}
            {...form.register('displayName')}
          />
          <TextField
            label="รหัสผ่าน"
            type="password"
            autoComplete="new-password"
            fullWidth
            margin="normal"
            error={Boolean(errors.password)}
            helperText={errors.password?.message ?? 'อย่างน้อย 10 ตัวอักษร'}
            {...form.register('password')}
          />
          <TextField
            select
            label="บทบาท"
            fullWidth
            margin="normal"
            defaultValue="STAFF"
            {...form.register('role')}
          >
            {ROLES.map((r) => (
              <MenuItem key={r} value={r}>
                {ADMIN_ROLE_TH[r]}
              </MenuItem>
            ))}
          </TextField>
          {error && <Alert severity="error">{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button type="submit" variant="contained" loading={create.isPending}>
            เพิ่ม
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function EditDialog({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (u: AdminUser) => void;
}) {
  const [role, setRole] = useState(user.role);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (input: Parameters<typeof adminApi.users.update>[1]) =>
      adminApi.users.update(user.id, input),
    onSuccess: (u) => {
      onClose();
      onSaved(u);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  function submit() {
    const input = {
      ...(displayName !== user.displayName && { displayName }),
      ...(role !== user.role && { role }),
      ...(password && { password }),
    };
    if (Object.keys(input).length === 0) return onClose();
    save.mutate(input);
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>แก้ไข {user.username}</DialogTitle>
      <DialogContent>
        <TextField
          label="ชื่อที่แสดง"
          fullWidth
          margin="normal"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <TextField
          select
          label="บทบาท"
          fullWidth
          margin="normal"
          value={role}
          disabled={isSelf}
          onChange={(e) => setRole(e.target.value as AdminRole)}
          helperText={isSelf ? 'เปลี่ยนบทบาทของตัวเองไม่ได้' : undefined}
        >
          {ROLES.map((r) => (
            <MenuItem key={r} value={r}>
              {ADMIN_ROLE_TH[r]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="ตั้งรหัสผ่านใหม่ (ไม่บังคับ)"
          type="password"
          autoComplete="new-password"
          fullWidth
          margin="normal"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          helperText="เปลี่ยนรหัส/บทบาทแล้ว ผู้ใช้ต้องเข้าสู่ระบบใหม่"
        />
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        {!isSelf ? (
          <Button
            color={user.isActive ? 'error' : 'success'}
            loading={save.isPending}
            onClick={() => save.mutate({ isActive: !user.isActive })}
          >
            {user.isActive ? 'ปิดบัญชี' : 'เปิดบัญชี'}
          </Button>
        ) : (
          <span />
        )}
        <span>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="contained" loading={save.isPending} onClick={submit}>
            บันทึก
          </Button>
        </span>
      </DialogActions>
    </Dialog>
  );
}
