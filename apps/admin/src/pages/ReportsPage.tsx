import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  MAX_REPORT_DAYS,
  Permission,
  VENDOR_STATUS_TH,
  type OccupancyRow,
  type RevenueRow,
  type VendorReportQuery,
  hasPermission,
} from '@market-booking/shared';
import DownloadIcon from '@mui/icons-material/Download';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { adminApi } from '../api/admin';
import { saveBlob } from '../lib/download';
import { errorMessage } from '../lib/errors';
import { formatBaht, formatPhone } from '../lib/format';
import { useAdmin } from '../lib/session';

type ReportTab = 'revenue' | 'occupancy' | 'vendors';
const TABS: { value: ReportTab; label: string }[] = [
  { value: 'revenue', label: 'รายได้' },
  { value: 'occupancy', label: 'การใช้ล็อค' },
  { value: 'vendors', label: 'ผู้ค้า' },
];

const num = (n: number) => n.toLocaleString('th-TH');
const percent = (rate: number) =>
  `${(rate * 100).toLocaleString('th-TH', { maximumFractionDigits: 1 })}%`;

/** วันที่เวลาไทย `YYYY-MM-DD` เลื่อนจากวันนี้ `months` เดือน (วันที่ 1 หรือวันสุดท้ายของเดือน) */
function monthEdge(months: number, end: boolean): string {
  const now = new Date(Date.now() + 7 * 3_600_000);
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months + (end ? 1 : 0), end ? 0 : 1),
  );
  return d.toISOString().slice(0, 10);
}

interface Filters {
  from: string;
  to: string;
  roundId?: string;
}

/** ตาราง + แถวรวม — คอลัมน์ตัวเลขชิดขวา */
function ReportTable<T>({
  label,
  columns,
  rows,
  total,
  rowKey,
}: {
  label: string;
  columns: { header: string; numeric?: boolean; cell: (row: T) => ReactNode }[];
  rows: T[];
  total?: T;
  rowKey: (row: T) => string;
}) {
  return (
    <TableContainer>
      <Table size="small" aria-label={label}>
        <TableHead>
          <TableRow>
            {columns.map((c) => (
              <TableCell
                key={c.header}
                align={c.numeric ? 'right' : 'left'}
                sx={{ fontWeight: 600 }}
              >
                {c.header}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length}>
                <Typography color="text.secondary">ไม่มีข้อมูลในช่วงนี้</Typography>
              </TableCell>
            </TableRow>
          )}
          {rows.map((r) => (
            <TableRow key={rowKey(r)} hover>
              {columns.map((c) => (
                <TableCell key={c.header} align={c.numeric ? 'right' : 'left'}>
                  {c.cell(r)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {total && rows.length > 0 && (
            <TableRow sx={{ '& td': { fontWeight: 700, borderTop: 2, borderColor: 'divider' } }}>
              {columns.map((c, i) => (
                <TableCell key={c.header} align={c.numeric ? 'right' : 'left'}>
                  {i === 0 ? 'รวม' : c.cell(total)}
                </TableCell>
              ))}
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function ExportButtons({ report, query }: { report: ReportTab; query: object }) {
  const [error, setError] = useState<string | null>(null);
  const download = useMutation({
    mutationFn: (format: 'xlsx' | 'csv') => adminApi.reports.download(report, query, format),
    onSuccess: ({ blob, filename }) => saveBlob(blob, filename),
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      {(['xlsx', 'csv'] as const).map((format) => (
        <Button
          key={format}
          size="small"
          variant="outlined"
          startIcon={<DownloadIcon />}
          loading={download.isPending && download.variables === format}
          onClick={() => {
            setError(null);
            download.mutate(format);
          }}
        >
          {format === 'xlsx' ? 'Excel' : 'CSV'}
        </Button>
      ))}
      {error && (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      )}
    </Stack>
  );
}

function GroupToggle<G extends string>({
  value,
  options,
  onChange,
}: {
  value: G;
  options: { value: G; label: string }[];
  onChange: (v: G) => void;
}) {
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={value}
      onChange={(_, v: G | null) => v && onChange(v)}
      aria-label="แยกตาม"
    >
      {options.map((o) => (
        <ToggleButton key={o.value} value={o.value}>
          {o.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

function RevenueTab({ filters }: { filters: Filters }) {
  const [groupBy, setGroupBy] = useState<'day' | 'round' | 'zone'>('day');
  const query = { ...filters, groupBy };
  const report = useQuery({
    queryKey: ['reports', 'revenue', query],
    queryFn: () => adminApi.reports.revenue(query),
  });
  const money = (n: number) => formatBaht(n);
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <GroupToggle
          value={groupBy}
          onChange={setGroupBy}
          options={[
            { value: 'day', label: 'วันขาย' },
            { value: 'round', label: 'รอบ' },
            { value: 'zone', label: 'โซน' },
          ]}
        />
        <ExportButtons report="revenue" query={query} />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        รายได้ = ยอดชำระที่อนุมัติแล้ว (สลิป + เงินสด) ของการจองในวันขายช่วงนี้ —
        การคืนเงินทำนอกระบบไม่ได้หักออก
      </Typography>
      {report.isPending && <LinearProgress />}
      {report.isError && <Alert severity="error">{errorMessage(report.error)}</Alert>}
      {report.data && (
        <ReportTable<RevenueRow>
          label="รายได้"
          rows={report.data.rows}
          total={{ key: 'total', label: 'รวม', ...report.data.total }}
          rowKey={(r) => r.key}
          columns={[
            { header: { day: 'วันขาย', round: 'รอบ', zone: 'โซน' }[groupBy], cell: (r) => r.label },
            { header: 'การจองที่ชำระแล้ว', numeric: true, cell: (r) => num(r.bookings) },
            { header: 'พร้อมเพย์', numeric: true, cell: (r) => money(r.promptpay) },
            { header: 'เงินสด', numeric: true, cell: (r) => money(r.cash) },
            { header: 'รายได้รวม', numeric: true, cell: (r) => money(r.revenue) },
          ]}
        />
      )}
    </Stack>
  );
}

function OccupancyTab({ filters }: { filters: Filters }) {
  const [groupBy, setGroupBy] = useState<'day' | 'zone'>('day');
  const query = { ...filters, groupBy };
  const report = useQuery({
    queryKey: ['reports', 'occupancy', query],
    queryFn: () => adminApi.reports.occupancy(query),
  });
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <GroupToggle
          value={groupBy}
          onChange={setGroupBy}
          options={[
            { value: 'day', label: 'วันขาย' },
            { value: 'zone', label: 'โซน' },
          ]}
        />
        <ExportButtons report="occupancy" query={query} />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        ล็อคที่ใช้ได้ = ล็อคที่เปิดใช้งานอยู่ ลบที่ปิดเฉพาะวัน (วันขายที่ยกเลิกไม่นับ)
      </Typography>
      {report.isPending && <LinearProgress />}
      {report.isError && <Alert severity="error">{errorMessage(report.error)}</Alert>}
      {report.data && (
        <ReportTable<OccupancyRow>
          label="การใช้ล็อค"
          rows={report.data.rows}
          total={{ key: 'total', label: 'รวม', ...report.data.total }}
          rowKey={(r) => r.key}
          columns={[
            { header: groupBy === 'day' ? 'วันขาย' : 'โซน', cell: (r) => r.label },
            { header: 'ล็อคที่ใช้ได้', numeric: true, cell: (r) => num(r.capacity) },
            { header: 'จองสำเร็จ', numeric: true, cell: (r) => num(r.confirmed) },
            { header: 'รอชำระ/ตรวจ', numeric: true, cell: (r) => num(r.pending) },
            {
              header: 'อัตราการจอง',
              numeric: true,
              cell: (r) => (
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', justifyContent: 'flex-end' }}
                >
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, r.rate * 100)}
                    sx={{ width: 80, height: 6, borderRadius: 3 }}
                  />
                  <span>{percent(r.rate)}</span>
                </Stack>
              ),
            },
          ]}
        />
      )}
    </Stack>
  );
}

const SORTS: { value: VendorReportQuery['sort']; label: string }[] = [
  { value: 'bookings', label: 'จองมากสุด' },
  { value: 'revenue', label: 'รายได้มากสุด' },
  { value: 'cancelled', label: 'ยกเลิก/ไม่ชำระมากสุด' },
  { value: 'noshow', label: 'ไม่มาขายมากสุด' },
];

function VendorsTab({ filters }: { filters: Filters }) {
  const [sort, setSort] = useState<VendorReportQuery['sort']>('bookings');
  const query = { ...filters, sort, limit: 50 };
  const report = useQuery({
    queryKey: ['reports', 'vendors', query],
    queryFn: () => adminApi.reports.vendors(query),
  });
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="เรียงตาม"
          value={sort}
          onChange={(e) => setSort(e.target.value as VendorReportQuery['sort'])}
          sx={{ minWidth: 220 }}
        >
          {SORTS.map((s) => (
            <MenuItem key={s.value} value={s.value}>
              {s.label}
            </MenuItem>
          ))}
        </TextField>
        <ExportButtons report="vendors" query={query} />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        50 อันดับแรก · "ไม่มาขาย" เป็นจำนวนสะสมทั้งหมด
        {report.data?.phoneMasked && ' · เบอร์โทรแสดงบางส่วนตามสิทธิ์ของบัญชีนี้'}
      </Typography>
      {report.isPending && <LinearProgress />}
      {report.isError && <Alert severity="error">{errorMessage(report.error)}</Alert>}
      {report.data && (
        <ReportTable
          label="ผู้ค้า"
          rows={report.data.rows}
          rowKey={(r) => r.vendorId}
          columns={[
            {
              header: 'ผู้ค้า',
              cell: (r) => (
                <>
                  {r.name}
                  {r.shopName && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {r.shopName}
                    </Typography>
                  )}
                </>
              ),
            },
            {
              header: 'เบอร์โทร',
              cell: (r) => (report.data.phoneMasked ? r.phone : formatPhone(r.phone)),
            },
            { header: 'สถานะ', cell: (r) => VENDOR_STATUS_TH[r.status] },
            { header: 'จองสำเร็จ', numeric: true, cell: (r) => num(r.bookings) },
            { header: 'ยกเลิก/ไม่ชำระ', numeric: true, cell: (r) => num(r.cancelled) },
            { header: 'รายได้', numeric: true, cell: (r) => formatBaht(r.revenue) },
            { header: 'ไม่มาขาย', numeric: true, cell: (r) => num(r.noshowCount) },
          ]}
        />
      )}
    </Stack>
  );
}

/** รายงาน (Phase 8) — ช่วงวันขาย + รอบ อยู่ใน URL (ส่งลิงก์ให้กันได้) */
export function ReportsPage() {
  const admin = useAdmin();
  const canPickRound = hasPermission(admin.role, Permission.ROUNDS_MANAGE);
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.value === params.get('tab'))?.value ?? 'revenue') as ReportTab;
  const from = params.get('from') ?? monthEdge(-1, false);
  const to = params.get('to') ?? monthEdge(1, true);
  const roundId = params.get('round') ?? undefined;
  const rounds = useQuery({
    queryKey: ['rounds'],
    queryFn: adminApi.rounds.list,
    enabled: canPickRound,
  });

  const set = (key: string, value: string | undefined) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  const rangeError =
    from > to
      ? 'วันเริ่มต้องไม่หลังวันสิ้นสุด'
      : days > MAX_REPORT_DAYS
        ? `ดูได้ครั้งละไม่เกิน ${MAX_REPORT_DAYS} วัน`
        : null;
  const filters: Filters = { from, to, ...(roundId && { roundId }) };

  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        รายงาน
      </Typography>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="วันขายตั้งแต่"
            type="date"
            size="small"
            value={from}
            onChange={(e) => set('from', e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="ถึง"
            type="date"
            size="small"
            value={to}
            onChange={(e) => set('to', e.target.value)}
            error={Boolean(rangeError)}
            helperText={rangeError}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          {canPickRound && (
            <TextField
              select
              size="small"
              label="รอบ"
              value={roundId ?? ''}
              onChange={(e) => set('round', e.target.value || undefined)}
              sx={{ minWidth: 240 }}
            >
              <MenuItem value="">ทุกรอบ</MenuItem>
              {(rounds.data ?? []).map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  {r.name}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Stack>
      </Paper>

      <Paper variant="outlined">
        <Tabs value={tab} onChange={(_, v: ReportTab) => set('tab', v)} sx={{ px: 2 }}>
          {TABS.map((t) => (
            <Tab key={t.value} value={t.value} label={t.label} />
          ))}
        </Tabs>
        <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
          {rangeError ? (
            <Alert severity="warning">{rangeError}</Alert>
          ) : tab === 'revenue' ? (
            <RevenueTab filters={filters} />
          ) : tab === 'occupancy' ? (
            <OccupancyTab filters={filters} />
          ) : (
            <VendorsTab filters={filters} />
          )}
        </Box>
      </Paper>
    </Stack>
  );
}
