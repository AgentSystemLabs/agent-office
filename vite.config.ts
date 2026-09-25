import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/client'),
  publicDir: resolve(import.meta.dirname, 'src/client/public'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'src/client/index.html'),
        login: resolve(import.meta.dirname, 'src/client/login.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4600',
      '/ws': { target: 'ws://localhost:4600', ws: true },
    },
  },
});
