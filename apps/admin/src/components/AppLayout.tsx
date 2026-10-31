import { useState, type ReactNode } from 'react';
import { NAV_ITEMS } from '../lib/nav';
import { NavLink, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission, hasPermission } from '@market-booking/shared';
import MenuIcon from '@mui/icons-material/Menu';
import AppBar from '@mui/material/AppBar';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { adminApi } from '../api/admin';
import { ADMIN_ROLE_TH } from '../lib/format';
import { useAdminRealtime } from '../lib/realtime';
import { useAdmin } from '../lib/session';

const DRAWER_WIDTH = 240;

export function AppLayout({ children }: { children: ReactNode }) {
  const admin = useAdmin();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const canReview = hasPermission(admin.role, Permission.VENDORS_REVIEW);

  // badge จำนวนรออนุมัติ — อัปเดตทันทีเมื่อมี `vendor:registered`; โหลดใหม่ทุก 5 นาทีเผื่อ socket หลุด
  useAdminRealtime(canReview);
  const counts = useQuery({
    queryKey: ['vendors', 'counts'],
    queryFn: adminApi.vendors.counts,
    enabled: canReview,
    refetchInterval: 300_000,
  });

  async function logout() {
    await adminApi.logout();
    queryClient.clear();
    navigate('/login', { replace: true });
  }

  const nav = (
    <List sx={{ pt: 1 }}>
      {NAV_ITEMS.filter(
        (item) => !item.permission || hasPermission(admin.role, item.permission),
      ).map((item) => (
        <ListItemButton
          key={item.to}
          component={NavLink}
          to={item.to}
          end={item.to === '/'}
          onClick={() => setMobileOpen(false)}
          sx={{ '&.active': { bgcolor: 'action.selected', fontWeight: 600 } }}
        >
          <ListItemIcon>
            {item.to === '/vendors' ? (
              <Badge badgeContent={counts.data?.PENDING} color="warning" max={999}>
                {item.icon}
              </Badge>
            ) : (
              item.icon
            )}
          </ListItemIcon>
          <ListItemText primary={item.label} />
        </ListItemButton>
      ))}
    </List>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'grey.50' }}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider', zIndex: (t) => t.zIndex.drawer + 1 }}
      >
        <Toolbar>
          <IconButton
            edge="start"
            sx={{ mr: 1, display: { md: 'none' } }}
            onClick={() => setMobileOpen(true)}
            aria-label="เปิดเมนู"
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" color="primary" sx={{ flexGrow: 1, fontWeight: 700 }}>
            ผู้ดูแลระบบ · จองล็อคตลาด
          </Typography>
          <Typography variant="body2" sx={{ mr: 2, display: { xs: 'none', sm: 'block' } }}>
            {admin.displayName} ({ADMIN_ROLE_TH[admin.role]})
          </Typography>
          <Button onClick={() => void logout()}>ออกจากระบบ</Button>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{ display: { md: 'none' }, '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
      >
        {nav}
      </Drawer>
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          width: DRAWER_WIDTH,
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <Toolbar />
        {nav}
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, md: 3 }, minWidth: 0 }}>
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}
