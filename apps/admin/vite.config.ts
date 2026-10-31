import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';
const port = Number(process.env.ADMIN_PORT ?? 5174);

export default defineConfig({
  plugins: [react()],
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
