import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

// The whiteboard's fonts (Excalidraw's hand-drawn Virgil/Excalifont and friends), served by the
// office itself rather than a CDN. Excalidraw looks for them under window.EXCALIDRAW_ASSET_PATH;
// the version in the path lets them be cached for good. Xiaolai (CJK, 12 MB) is left out: Excalidraw
// falls back to its CDN for that one, only when someone writes Chinese, Japanese or Korean.
const excalidrawDir = resolve(import.meta.dirname, 'node_modules/@excalidraw/excalidraw');
const excalidrawVersion = (JSON.parse(readFileSync(join(excalidrawDir, 'package.json'), 'utf8')) as { version: string }).version;
const EXCALIDRAW_ASSETS = `/assets/excalidraw-${excalidrawVersion}/`;

function excalidrawFonts(): Plugin {
  const fonts = join(excalidrawDir, 'dist/prod/fonts');
  const files = (dir: string, rel = ''): string[] =>
    readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((d) => {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) return d.name === 'Xiaolai' ? [] : files(dir, r);
      return d.name.endsWith('.woff2') ? [r] : [];
    });
  return {
    name: 'excalidraw-fonts',
    configureServer(server) {
      server.middlewares.use(`${EXCALIDRAW_ASSETS}fonts/`, (req, res, next) => {
        const file = join(fonts, decodeURIComponent((req.url ?? '').split('?')[0]));
        if (!file.startsWith(fonts + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('content-type', 'font/woff2');
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const f of files(fonts)) this.emitFile({ type: 'asset', fileName: `${EXCALIDRAW_ASSETS.slice(1)}fonts/${f}`, source: readFileSync(join(fonts, f)) });
    },
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/client'),
  publicDir: resolve(import.meta.dirname, 'src/client/public'),
  plugins: [excalidrawFonts()],
  define: {
    __EXCALIDRAW_ASSETS__: JSON.stringify(EXCALIDRAW_ASSETS),
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      onwarn(warning, warn) {
        // Excalidraw's Radix UI parts start with "use client", which means nothing outside React Server Components.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        warn(warning);
      },
      input: {
        main: resolve(import.meta.dirname, 'src/client/index.html'),
        lite: resolve(import.meta.dirname, 'src/client/lite.html'),
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
