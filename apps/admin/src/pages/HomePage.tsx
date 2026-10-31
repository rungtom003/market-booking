import { Link } from 'react-router';
import { hasPermission } from '@market-booking/shared';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { NAV_ITEMS } from '../lib/nav';
import { ADMIN_ROLE_TH } from '../lib/format';
import { useAdmin } from '../lib/session';

/** หน้าแรก — Dashboard จริงมาใน Phase 8 */
export function HomePage() {
  const admin = useAdmin();
  const items = NAV_ITEMS.filter(
    (i) => i.to !== '/' && (!i.permission || hasPermission(admin.role, i.permission)),
  );
  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>
        สวัสดี {admin.displayName}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        บทบาท: {ADMIN_ROLE_TH[admin.role]}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {items.map((i) => (
          <Button key={i.to} component={Link} to={i.to} variant="outlined" startIcon={i.icon}>
            {i.label}
          </Button>
        ))}
      </Stack>
      {items.length === 0 && (
        <Typography color="text.secondary">
          เมนูของบทบาทนี้จะเปิดในระยะถัดไป (ตรวจสลิป / รายงาน)
        </Typography>
      )}
    </Paper>
  );
}
