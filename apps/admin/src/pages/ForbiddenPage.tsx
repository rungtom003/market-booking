import { Link } from 'react-router';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';

export function ForbiddenPage() {
  return (
    <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
      <Typography variant="h3" color="text.secondary" gutterBottom>
        403
      </Typography>
      <Typography variant="h6" gutterBottom>
        คุณไม่มีสิทธิ์เข้าถึงหน้านี้
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        หากต้องใช้งาน กรุณาติดต่อผู้ดูแลระบบสูงสุด
      </Typography>
      <Button component={Link} to="/" variant="contained">
        กลับหน้าหลัก
      </Button>
    </Paper>
  );
}
