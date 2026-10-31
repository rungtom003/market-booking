import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatIsoDateTh } from '@market-booking/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { adminApi } from '../api/admin';
import { RoundDialog } from '../components/RoundDialog';
import { errorMessage } from '../lib/errors';
import { formatDateTime, roundStateChip } from '../lib/format';

/** รายการรอบการจอง ใหม่สุดก่อน */
export function RoundsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const rounds = useQuery({ queryKey: ['rounds'], queryFn: adminApi.rounds.list });

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          รอบการจอง
        </Typography>
        <Button variant="contained" onClick={() => setCreating(true)}>
          สร้างรอบ
        </Button>
      </Stack>
      {rounds.isError && <Alert severity="error">{errorMessage(rounds.error)}</Alert>}

      <Paper variant="outlined">
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="รายการรอบการจอง">
            <TableHead>
              <TableRow>
                <TableCell>ชื่อรอบ</TableCell>
                <TableCell>สถานะ</TableCell>
                <TableCell>เปิดจอง</TableCell>
                <TableCell>ปิดจอง</TableCell>
                <TableCell>วันขาย</TableCell>
                <TableCell align="right">ล็อค/ผู้ค้า/วัน</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rounds.data?.map((r) => {
                const chip = roundStateChip(r);
                return (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <Link component={RouterLink} to={`/rounds/${r.id}`}>
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" color={chip.color} label={chip.label} />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.openAt)}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.closeAt)}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {r.status === 'CANCELLED'
                        ? '—'
                        : r.firstMarketDate && r.lastMarketDate
                          ? `${r.marketDayCount} วัน (${formatIsoDateTh(r.firstMarketDate)}${
                              r.marketDayCount > 1 ? ` – ${formatIsoDateTh(r.lastMarketDate)}` : ''
                            })`
                          : 'ยังไม่มีวันขาย'}
                    </TableCell>
                    <TableCell align="right">{r.maxStallsPerVendor}</TableCell>
                  </TableRow>
                );
              })}
              {rounds.data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>ยังไม่มีรอบการจอง — กด "สร้างรอบ" เพื่อเริ่ม</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </Paper>

      {creating && (
        <RoundDialog
          round={null}
          onClose={() => setCreating(false)}
          onSaved={(r) => {
            queryClient.setQueryData(['round', r.id], r);
            void queryClient.invalidateQueries({ queryKey: ['rounds'] });
            void navigate(`/rounds/${r.id}`, { state: { notice: `สร้างรอบ ${r.name} แล้ว` } });
          }}
        />
      )}
    </Stack>
  );
}
