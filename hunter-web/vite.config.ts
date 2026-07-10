import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: '/hunter',
  build: {
    outDir: path.resolve(__dirname, '../out/hunter'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5178,
    proxy: {
      '/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
