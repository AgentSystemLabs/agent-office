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
        claim: resolve(import.meta.dirname, 'src/client/claim.html'),
        join: resolve(import.meta.dirname, 'src/client/join.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Not the string shorthand: that sets changeOrigin, so /api would see Host :4600 while /ws sees
      // Vite's port, and the session cookie (named per port, see auth.ts) would never reach the socket.
      '/api': { target: 'http://localhost:4600', changeOrigin: false },
      '/ws': { target: 'ws://localhost:4600', ws: true },
    },
  },
});
