#!/usr/bin/env node
// Package a self-contained Office browser client for Pi Pocket's extension asset server.
// Run `npm run build:pocket` first. No live Pocket files are read or changed.
import { readFile, writeFile, mkdir, readdir, cp, stat, rm } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const input = join(root, 'dist/pocket');
const output = join(root, 'integrations/pi-pocket/office-v2-client');
const world = join(output, 'world');
// Only this generated, ignored output folder is replaced. Source files remain untouched.
await rm(world, { recursive: true, force: true });
await mkdir(world, { recursive: true });

async function files(dir) {
  const all = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) all.push(...await files(file));
    else if (entry.isFile()) all.push(file);
    else throw new Error(`Refusing non-regular build asset: ${file}`);
  }
  return all;
}

const allowed = new Set(['js', 'mjs', 'css', 'json', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'woff2']);
for (const source of await files(input)) {
  const rel = relative(input, source);
  if (rel.endsWith('.html')) continue;
  // The extension server permits images, not .glb. GLTFLoader reads binary buffers
  // by their GLB header, so the local image suffix changes no model content.
  const target = join(world, rel.replace(/\.glb$/, '.glb.png'));
  const ext = target.split('.').at(-1);
  if (!allowed.has(ext)) continue;
  await mkdir(dirname(target), { recursive: true });
  if (ext === 'js' || ext === 'css') {
    const original = await readFile(source, 'utf8');
    const rewritten = original.replace(/\.glb(?=["'`?])/g, '.glb.png');
    await writeFile(target, rewritten);
  } else {
    await cp(source, target);
  }
  if ((await stat(target)).size > 8 * 1024 * 1024) throw new Error(`Asset exceeds Pocket's 8 MiB limit: ${rel}`);
}

const html = (await readFile(join(input, 'index.html'), 'utf8'))
  .replace(/<link rel="icon"[^>]*>/g, '')
  .replace(/<title>[^<]*<\/title>/, '<title>Office v2 · Pocket runtime</title>');
if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) throw new Error('The Office document must not contain inline scripts.');
await writeFile(join(output, 'office-document.json'), JSON.stringify({ html }));
await cp(join(root, 'LICENSE'), join(output, 'AGENT-OFFICE-LICENSE.txt'));
const pocketRoot = process.env.PI_POCKET_ROOT ?? '/opt/pi-pocket';
await cp(join(pocketRoot, 'types/pocket.d.ts'), join(root, 'integrations/pi-pocket/_pocket.d.ts'));
console.log(`Pocket extension package: ${relative(root, dirname(output))}`);
console.log('Review the complete package before installing. No live server was changed.');
