import type { ReactNode } from 'react';
import { Permission } from '@market-booking/shared';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import DashboardIcon from '@mui/icons-material/Dashboard';
import GridViewIcon from '@mui/icons-material/GridView';
import LayersIcon from '@mui/icons-material/Layers';
import SettingsIcon from '@mui/icons-material/Settings';
import StorefrontIcon from '@mui/icons-material/Storefront';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** ไม่ระบุ = ทุกคนเห็น */
  permission?: Permission;
}

/** เมนูซ่อนตามสิทธิ์ (ตาราง Overview §2) — หน้าเองก็ตรวจซ้ำ (RequirePermission) และ API ตรวจอีกชั้น */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'หน้าหลัก', icon: <DashboardIcon /> },
  {
    to: '/vendors',
    label: 'ผู้ค้า',
    icon: <StorefrontIcon />,
    permission: Permission.VENDORS_REVIEW,
  },
  {
    to: '/stalls',
    label: 'ล็อคและผังตลาด',
    icon: <GridViewIcon />,
    permission: Permission.MARKET_LAYOUT_MANAGE,
  },
  {
    to: '/zones',
    label: 'โซนและประเภทสินค้า',
    icon: <LayersIcon />,
    permission: Permission.MARKET_LAYOUT_MANAGE,
  },
  {
    to: '/settings',
    label: 'ตั้งค่าระบบ',
    icon: <SettingsIcon />,
    permission: Permission.SETTINGS_MANAGE,
  },
  {
    to: '/users',
    label: 'ผู้ดูแลระบบ',
    icon: <AdminPanelSettingsIcon />,
    permission: Permission.ADMIN_USERS_MANAGE,
  },
];
