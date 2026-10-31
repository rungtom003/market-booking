import Alert from '@mui/material/Alert';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useHealth } from '../api/health';

export function HomePage() {
  const health = useHealth();

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        ผู้ดูแลระบบ · จองล็อคตลาด
      </Typography>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          สถานะระบบ
        </Typography>
        {health.isPending && <Alert severity="info">กำลังตรวจสอบ…</Alert>}
        {health.isError && <Alert severity="error">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้</Alert>}
        {health.isSuccess && (
          <Alert severity="success">
            เซิร์ฟเวอร์ทำงานปกติ · uptime {health.data.uptime} วินาที
          </Alert>
        )}
      </Paper>
    </Container>
  );
}
