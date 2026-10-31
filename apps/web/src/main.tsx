import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { App } from './App';
import { queryClient } from './lib/query-client';
import './index.css';

// ข้อความ validation ทั่วไปของ Zod เป็นภาษาไทย (ข้อความเฉพาะฟิลด์อยู่ใน schema ของ packages/shared)
z.config(z.locales.th());

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
