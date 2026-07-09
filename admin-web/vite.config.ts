import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  // Sub-G fix: server.ts mounts admin SPA at '/admin/*' via express.static.
  // base: '/admin' (no trailing slash) so both '/admin' and '/admin/...' are
  // served as the SPA — Vite's default behaviour is to show a "did you mean
  // /admin/?" tip when the request URL equals the base URL minus the trailing
  // slash, which broke the dev-server flow.
  base: '/admin',
  build: {
    outDir: path.resolve(__dirname, '../out/admin'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5174,
    proxy: {
      '/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
