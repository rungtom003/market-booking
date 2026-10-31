import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    primary: { main: '#15803d' },
  },
  typography: {
    fontFamily: ['"Noto Sans Thai"', 'Sarabun', 'system-ui', 'sans-serif'].join(','),
  },
});
