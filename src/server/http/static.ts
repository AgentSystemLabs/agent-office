// The client bundle: finding it, and serving its files.
import type http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary',
};

export function findPublicDir(): string {
  // Two folders up from here, as from server.ts before it: src/ under tsx, dist/server/ once built.
  const here = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const candidates = [path.resolve(here, '../../public'), path.resolve(here, '../../dist/public')];
  for (const c of candidates) if (existsSync(path.join(c, 'index.html'))) return c;
  throw new Error(`Client bundle not found (looked in ${candidates.join(', ')}). Run \`npm run build\`.`);
}

export function serveFile(res: http.ServerResponse, file: string, cache: boolean) {
  const ext = path.extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': cache ? 'public, max-age=31536000, immutable' : 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  });
  createReadStream(file).pipe(res);
}

/** A file of the client bundle, or undefined when it's missing, a folder, or outside the bundle. */
export function publicFile(publicDir: string, p: string): string | undefined {
  const file = path.join(publicDir, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  return file.startsWith(publicDir + path.sep) && existsSync(file) && statSync(file).isFile() ? file : undefined;
}
