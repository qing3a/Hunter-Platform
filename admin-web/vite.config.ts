import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  // Sub-G fix: server.ts mounts admin SPA at '/admin/*' via express.static.
  // base: '/admin/' tells Vite to emit asset paths with this prefix so
  // <script src="/admin/assets/..."> resolves correctly in the served HTML.
  base: '/admin/',
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
