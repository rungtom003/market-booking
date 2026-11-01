import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AUDIT_ACTION_TH, type AuditLogEntry } from '@market-booking/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import ListSubheader from '@mui/material/ListSubheader';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { adminApi } from '../api/admin';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';

const ACTOR_TH = { ADMIN: 'เจ้าหน้าที่', VENDOR: 'ผู้ค้า', SYSTEM: 'ระบบ' } as const;
const ENTITY_TH: Record<string, string> = {
  vendor: 'ผู้ค้า',
  booking: 'การจอง',
  payment: 'การชำระเงิน',
  round: 'รอบ',
  market_day: 'วันขาย',
  stall: 'ล็อค',
  zone: 'โซน',
  product_category: 'ประเภทสินค้า',
  settings: 'ตั้งค่า',
  admin_user: 'ผู้ดูแลระบบ',
  report: 'รายงาน',
};

const actionLabel = (action: string) => AUDIT_ACTION_TH[action] ?? action;

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <Typography color="text.secondary">—</Typography>;
  }
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 1.5,
        bgcolor: 'action.hover',
        borderRadius: 1,
        fontSize: 13,
        overflow: 'auto',
        maxHeight: 320,
      }}
    >
      {JSON.stringify(value, null, 2)}
    </Box>
  );
}

function DetailDialog({ entry, onClose }: { entry: AuditLogEntry | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(entry)} onClose={onClose} maxWidth="md" fullWidth>
      {entry && (
        <>
          <DialogTitle>{actionLabel(entry.action)}</DialogTitle>
          <DialogContent>
            <Stack spacing={2}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'max-content 1fr',
                  columnGap: 2,
                  rowGap: 0.5,
                }}
              >
                <Typography color="text.secondary">เวลา</Typography>
                <Typography>{formatDateTime(entry.createdAt)}</Typography>
                <Typography color="text.secondary">ผู้กระทำ</Typography>
                <Typography>
                  {ACTOR_TH[entry.actorType]}
                  {entry.actorName && ` · ${entry.actorName}`}
                </Typography>
                <Typography color="text.secondary">action</Typography>
                <Typography sx={{ fontFamily: 'monospace' }}>{entry.action}</Typography>
                <Typography color="text.secondary">รายการ</Typography>
                <Typography sx={{ wordBreak: 'break-all' }}>
                  {ENTITY_TH[entry.entityType] ?? entry.entityType}
                  {entry.entityId && ` · ${entry.entityId}`}
                </Typography>
                {entry.ip && (
                  <>
                    <Typography color="text.secondary">IP</Typography>
                    <Typography>{entry.ip}</Typography>
                  </>
                )}
                {entry.userAgent && (
                  <>
                    <Typography color="text.secondary">อุปกรณ์</Typography>
                    <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                      {entry.userAgent}
                    </Typography>
                  </>
                )}
              </Box>
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  ก่อน
                </Typography>
                <Json value={entry.before} />
              </Box>
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  หลัง
                </Typography>
                <Json value={entry.after} />
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>ปิด</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}

/** ประวัติการใช้งาน (Audit Log) — ตัวกรองอยู่ใน URL; คลิกแถวดูข้อมูลก่อน/หลัง */
export function AuditLogPage() {
  const [params, setParams] = useSearchParams();
  const [pagination, setPagination] = useState({ page: 0, pageSize: 25 });
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);
  const filters = {
    actorType: params.get('actor') ?? '',
    action: params.get('action') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    entityId: params.get('entity') ?? '',
  };
  const set = (key: string, value: string) => {
    setPagination((p) => ({ ...p, page: 0 }));
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  const query = {
    actorType: (filters.actorType || undefined) as AuditLogEntry['actorType'] | undefined,
    action: filters.action || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    // ใส่ id ไม่ครบไม่ส่ง (API รับเฉพาะ UUID)
    entityId: /^[0-9a-f-]{36}$/i.test(filters.entityId) ? filters.entityId : undefined,
    page: pagination.page + 1,
    pageSize: pagination.pageSize,
  };
  const list = useQuery({
    queryKey: ['audit-logs', query],
    queryFn: () => adminApi.auditLogs.list(query),
    placeholderData: keepPreviousData,
  });
  const actions = useQuery({
    queryKey: ['audit-logs', 'actions'],
    queryFn: adminApi.auditLogs.actions,
  });

  /** action จัดกลุ่มตาม entity + ตัวเลือก "ทั้งหมดของกลุ่ม" (`vendor.`) */
  const actionGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const a of actions.data ?? []) {
      const prefix = a.split('.')[0]!;
      groups.set(prefix, [...(groups.get(prefix) ?? []), a]);
    }
    return [...groups.entries()];
  }, [actions.data]);

  const columns: GridColDef<AuditLogEntry>[] = [
    {
      field: 'createdAt',
      headerName: 'เวลา',
      width: 170,
      sortable: false,
      valueFormatter: (v: string) => formatDateTime(v),
    },
    {
      field: 'actorType',
      headerName: 'ผู้กระทำ',
      flex: 1,
      minWidth: 200,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', height: '100%' }}>
          <Chip size="small" label={ACTOR_TH[row.actorType]} />
          <span>{row.actorName ?? ''}</span>
        </Stack>
      ),
    },
    {
      field: 'action',
      headerName: 'การกระทำ',
      flex: 1,
      minWidth: 180,
      sortable: false,
      valueFormatter: (v: string) => actionLabel(v),
    },
    {
      field: 'entityType',
      headerName: 'รายการ',
      width: 140,
      sortable: false,
      valueFormatter: (v: string) => ENTITY_TH[v] ?? v,
    },
    { field: 'ip', headerName: 'IP', width: 140, sortable: false },
  ];

  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        ประวัติการใช้งาน (Audit Log)
      </Typography>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField
            select
            size="small"
            label="ผู้กระทำ"
            value={filters.actorType}
            onChange={(e) => set('actor', e.target.value)}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">ทั้งหมด</MenuItem>
            {Object.entries(ACTOR_TH).map(([k, v]) => (
              <MenuItem key={k} value={k}>
                {v}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="การกระทำ"
            value={filters.action}
            onChange={(e) => set('action', e.target.value)}
            sx={{ minWidth: 240 }}
          >
            <MenuItem value="">ทั้งหมด</MenuItem>
            {actionGroups.flatMap(([prefix, list]) => [
              <ListSubheader key={`h-${prefix}`}>{ENTITY_TH[prefix] ?? prefix}</ListSubheader>,
              <MenuItem key={`${prefix}.`} value={`${prefix}.`}>
                ทั้งหมดของ{ENTITY_TH[prefix] ?? prefix}
              </MenuItem>,
              ...list.map((a) => (
                <MenuItem key={a} value={a} sx={{ pl: 4 }}>
                  {actionLabel(a)}
                </MenuItem>
              )),
            ])}
          </TextField>
          <TextField
            label="ตั้งแต่"
            type="date"
            size="small"
            value={filters.from}
            onChange={(e) => set('from', e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="ถึง"
            type="date"
            size="small"
            value={filters.to}
            onChange={(e) => set('to', e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="id ของรายการ"
            size="small"
            value={filters.entityId}
            onChange={(e) => set('entity', e.target.value.trim())}
            placeholder="UUID"
            sx={{ minWidth: 200 }}
          />
        </Stack>
      </Paper>
      {list.isError && <Alert severity="error">{errorMessage(list.error)}</Alert>}
      <Paper variant="outlined">
        <DataGrid
          rows={list.data?.data ?? []}
          columns={columns}
          rowCount={list.data?.meta?.total ?? 0}
          loading={list.isFetching}
          paginationMode="server"
          paginationModel={pagination}
          onPaginationModelChange={setPagination}
          pageSizeOptions={[25, 50, 100]}
          disableColumnMenu
          disableRowSelectionOnClick
          onRowClick={({ row }) => setSelected(row)}
          localeText={{ noRowsLabel: 'ไม่มีรายการ' }}
          aria-label="ประวัติการใช้งาน"
          sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        />
      </Paper>
      <DetailDialog entry={selected} onClose={() => setSelected(null)} />
    </Stack>
  );
}
