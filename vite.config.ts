import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
// Immersive Web SDK emulation + agent browser, only for XR test sessions (IWSDK=1): production
// builds and normal dev never load it. `iwsdk dev up` (or IWSDK=1 vite) serves the office with an
// emulated Quest + the /__iwer_mcp bridge the iwsdk-runtime MCP server drives.
const iwsdk = process.env.IWSDK
  ? [(await import('@iwsdk/vite-plugin-dev')).iwsdkDev({ emulator: { device: 'metaQuest3' }, ai: { mode: process.env.IWSDK_HEADLESS ? 'agent' : 'collaborate' }, workspace: { browserAutomation: true } }), iwsdkTestShim()]
  : [];
// The office is not an IWSDK framework scene, so no in-page runtime ever fires the bridge's
// `iwsdk:mcp-runtime-ready` event and the managed command path (browser/xr tools, MCP) stays
// dark. This test-only shim marks the page command-ready; commands then fall through to the
// IWER emulator's own dispatcher (device.remote), which is all an agent needs here.
function iwsdkTestShim(): Plugin {
  return {
    name: 'iwsdk-test-shim',
    transformIndexHtml: () => [{
      tag: 'script',
      injectTo: 'body',
      children: `window.FRAMEWORK_MCP_RUNTIME={handles:()=>false};for(const t of[0,500,2000])setTimeout(()=>window.dispatchEvent(new Event('iwsdk:mcp-runtime-ready')),t);`,
    }],
  };
}
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

// Dev-only mirror of the office server's clean routes (see server.ts): without this, the
// login redirect lands on a Vite 404 in `npm run dev` and in IWSDK test sessions, which also
// starves the IWSDK browser bridge of a stable app page.
function devRoutes(): Plugin {
  return {
    name: 'dev-routes',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/login' || req.url === '/claim' || req.url === '/join') req.url += '.html';
        next();
      });
    },
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/client'),
  publicDir: resolve(import.meta.dirname, 'src/client/public'),
  plugins: [excalidrawFonts(), ...iwsdk, devRoutes()],
  define: {
    __EXCALIDRAW_ASSETS__: JSON.stringify(EXCALIDRAW_ASSETS),
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // xrblocks' simulator, spatial-UI, AI and vision chunks import these, but only from lazy
      // chunks the office never loads (it uses Hands alone, see vr/session.ts). Per xrblocks'
      // own docs, they stay external instead of installed; three and its addons still bundle.
      external: (id) =>
        /^(lit|lit-html|@pmndrs\/uikit|@preact\/signals-core|@sparkjsdev\/spark|openai|three-mesh-bvh|three-pathfinding|@google\/genai|@huggingface\/transformers|@mediapipe\/tasks-(audio|vision))($|\/)/.test(id),
      onwarn(warning, warn) {
        // Excalidraw's Radix UI parts start with "use client", which means nothing outside React Server Components.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        warn(warning);
      },
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
      // IWSDK test sessions ride the office's own HTTPS (self-signed) instead of plain HTTP.
      '/api': process.env.IWSDK ? { target: 'https://localhost:4600', changeOrigin: false, secure: false } : { target: 'http://localhost:4600', changeOrigin: false },
      '/ws': process.env.IWSDK ? { target: 'wss://localhost:4600', ws: true, secure: false } : { target: 'ws://localhost:4600', ws: true },
    },
  },
});
