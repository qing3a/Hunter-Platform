import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: '/candidate',
  build: {
    outDir: path.resolve(__dirname, '../out/candidate'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5177,
    proxy: {
      '/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
