import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    {
      // SPA fallback: rewrite role paths to / for client-side routing.
      // Without this, dev-server visiting /pm/login 404s.
      name: 'app-spa-fallback',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (
            req.url &&
            req.headers.accept?.includes('text/html') &&
            /^\/(p|h|c|pm|hr|candidate|hunter|app|login|workspace|home|browse|profile|settings)(\/|$|\?)/.test(req.url)
          ) {
            req.url = '/';
          }
          next();
        });
      },
    },
  ],
  base: '/',
  build: {
    outDir: path.resolve(__dirname, '../out/app'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5175,
    proxy: {
      '/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
