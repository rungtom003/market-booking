import { useDeferredValue, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminVendorListItem, VendorStatus } from '@market-booking/shared';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DataGrid } from '@mui/x-data-grid';
import type { GridColDef, GridPaginationModel, GridRowSelectionModel } from '@mui/x-data-grid';
import { adminApi } from '../api/admin';
import { VendorDrawer } from '../components/VendorDrawer';
import { errorMessage } from '../lib/errors';
import { VENDOR_STATUS_COLOR, VENDOR_STATUS_TH, formatDateTime, formatPhone } from '../lib/format';

type TabValue = VendorStatus | 'ALL';
const TABS: TabValue[] = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'ALL'];

const columns: GridColDef<AdminVendorListItem>[] = [
  {
    field: 'name',
    headerName: 'ชื่อ',
    flex: 1,
    minWidth: 160,
    valueGetter: (_v, row) => `${row.firstName} ${row.lastName}`,
  },
  {
    field: 'shopName',
    headerName: 'ร้าน',
    flex: 1,
    minWidth: 140,
    valueFormatter: (v) => v ?? '—',
  },
  {
    field: 'phone',
    headerName: 'เบอร์',
    width: 130,
    valueFormatter: (v: string) => formatPhone(v),
  },
  {
    field: 'productCategoryName',
    headerName: 'ประเภทสินค้า',
    width: 130,
    valueFormatter: (v) => v ?? '—',
  },
  {
    field: 'status',
    headerName: 'สถานะ',
    width: 120,
    renderCell: ({ value, row }) =>
      row.deletedAt ? (
        <Chip size="small" variant="outlined" label="ลบข้อมูลแล้ว" />
      ) : (
        <Chip
          size="small"
          label={VENDOR_STATUS_TH[value as VendorStatus]}
          color={VENDOR_STATUS_COLOR[value as VendorStatus]}
        />
      ),
  },
  {
    field: 'createdAt',
    headerName: 'สมัครเมื่อ',
    width: 170,
    valueFormatter: (v: string) => formatDateTime(v),
  },
];

const EMPTY_SELECTION: GridRowSelectionModel = { type: 'include', ids: new Set() };

export function VendorsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabValue>('PENDING');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 20 });
  const [selection, setSelection] = useState<GridRowSelectionModel>(EMPTY_SELECTION);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ severity: 'success' | 'error'; text: string } | null>(
    null,
  );

  const counts = useQuery({ queryKey: ['vendors', 'counts'], queryFn: adminApi.vendors.counts });
  const list = useQuery({
    queryKey: ['vendors', 'list', tab, q, pagination],
    queryFn: () =>
      adminApi.vendors.list({
        status: tab === 'ALL' ? undefined : tab,
        q: q || undefined,
        page: pagination.page + 1,
        pageSize: pagination.pageSize,
      }),
    placeholderData: keepPreviousData,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['vendors'] });
  // "เลือกทั้งหมด" ของ DataGrid (v8+) ได้ type 'exclude' = ทุกแถวในหน้า ยกเว้น ids
  const rows = list.data?.data ?? [];
  const selectedIds =
    selection.type === 'include'
      ? [...selection.ids].map(String)
      : rows.map((r) => r.id).filter((id) => !selection.ids.has(id));

  const bulk = useMutation({
    mutationFn: adminApi.vendors.bulkApprove,
    onSuccess: (res) => {
      setSelection(EMPTY_SELECTION);
      setNotice({
        severity: 'success',
        text: `อนุมัติ ${res.approved.length} ราย${res.skipped.length ? ` (ข้าม ${res.skipped.length} ราย — ไม่ได้รออนุมัติแล้ว)` : ''}`,
      });
      void refresh();
    },
    onError: (e) => setNotice({ severity: 'error', text: errorMessage(e) }),
  });

  function changeTab(next: TabValue) {
    setTab(next);
    setSelection(EMPTY_SELECTION);
    setPagination((p) => ({ ...p, page: 0 }));
  }

  const total = counts.data ? Object.values(counts.data).reduce((a, b) => a + b, 0) : undefined;
  const countOf = (t: TabValue) => (t === 'ALL' ? total : counts.data?.[t]);

  return (
    <Stack spacing={2}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        ผู้ค้า
      </Typography>
      <Paper variant="outlined">
        <Tabs value={tab} onChange={(_e, v: TabValue) => changeTab(v)} variant="scrollable">
          {TABS.map((t) => (
            <Tab
              key={t}
              value={t}
              label={`${t === 'ALL' ? 'ทั้งหมด' : VENDOR_STATUS_TH[t]}${countOf(t) !== undefined ? ` (${countOf(t)})` : ''}`}
            />
          ))}
        </Tabs>
      </Paper>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { sm: 'center' } }}
      >
        <TextField
          size="small"
          label="ค้นหา ชื่อ / ร้าน / เบอร์"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPagination((p) => ({ ...p, page: 0 }));
          }}
          sx={{ minWidth: 260 }}
        />
        {tab === 'PENDING' && (
          <>
            <Button
              variant="contained"
              disabled={selectedIds.length === 0}
              loading={bulk.isPending}
              onClick={() => bulk.mutate({ ids: selectedIds })}
            >
              อนุมัติที่เลือก ({selectedIds.length})
            </Button>
            <Button
              variant="outlined"
              disabled={!counts.data?.PENDING}
              onClick={() => {
                if (
                  window.confirm(
                    `อนุมัติผู้ค้าที่รออนุมัติทั้งหมด ${counts.data?.PENDING ?? 0} ราย?`,
                  )
                ) {
                  bulk.mutate({ allPending: true });
                }
              }}
            >
              อนุมัติทั้งหมดที่ค้าง
            </Button>
          </>
        )}
      </Stack>

      {notice && (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
      {list.isError && <Alert severity="error">{errorMessage(list.error)}</Alert>}

      <Paper variant="outlined" sx={{ height: 600 }}>
        <DataGrid
          rows={rows}
          rowCount={list.data?.meta?.total ?? 0}
          columns={columns}
          loading={list.isFetching}
          paginationMode="server"
          paginationModel={pagination}
          onPaginationModelChange={setPagination}
          pageSizeOptions={[20, 50, 100]}
          checkboxSelection={tab === 'PENDING'}
          disableRowSelectionOnClick
          rowSelectionModel={selection}
          onRowSelectionModelChange={setSelection}
          onRowClick={({ id }) => setOpenId(String(id))}
          localeText={{ noRowsLabel: 'ไม่มีรายการ' }}
          sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        />
      </Paper>

      <VendorDrawer
        vendorId={openId}
        onClose={() => setOpenId(null)}
        onChanged={(text) => {
          setNotice({ severity: 'success', text });
          void refresh();
        }}
      />
    </Stack>
  );
}
