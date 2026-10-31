import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { App } from './App';
import { queryClient } from './lib/query-client';
import { theme } from './lib/theme';

// ข้อความ validation ทั่วไปของ Zod เป็นภาษาไทย (ข้อความเฉพาะฟิลด์อยู่ใน schema ของ packages/shared)
z.config(z.locales.th());

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
