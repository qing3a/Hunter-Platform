import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: '/admin/employer',
  build: {
    outDir: path.resolve(__dirname, '../out/employer'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5176,
    proxy: {
      '/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
