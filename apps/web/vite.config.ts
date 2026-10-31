import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';
const port = Number(process.env.WEB_PORT ?? 5173);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // อ่าน .env ที่ root ของ monorepo (Vite เปิดให้ฝั่ง browser เฉพาะตัวแปรที่ขึ้นต้นด้วย VITE_)
  envDir: '../../',
  server: {
    port,
    strictPort: true,
    // dev ใช้ proxy ให้ path เหมือน production (Nginx: /api, /socket.io → api)
    proxy: {
      '/api': apiTarget,
      '/socket.io': { target: apiTarget, ws: true },
    },
  },
  preview: {
    port,
    strictPort: true,
  },
});
