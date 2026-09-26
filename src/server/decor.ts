import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_DECOR, checkImageUrl, sanitizePlacement, type Decoration } from '../shared/decor.js';

/** The pictures on the office walls, saved in .agent-office/decor.json. */
export class Decor {
  private items: Decoration[] = [];
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'decor.json');
    this.load();
  }

  list(): Decoration[] {
    return this.items;
  }

  add(input: unknown, by: string): Decoration | string {
    if (this.items.length >= MAX_DECOR) return `The walls are full (${MAX_DECOR} pictures). Take one down first.`;
    const p = sanitizePlacement(input);
    if (typeof p === 'string') return p;
    const d: Decoration = { ...p, id: randomBytes(5).toString('hex'), by, at: Date.now() };
    this.items.push(d);
    this.save();
    return d;
  }

  /** Changes any part of a picture's placement; what the patch leaves out stays as it was. */
  update(id: string, patch: unknown): Decoration | string {
    const i = this.items.findIndex((d) => d.id === id);
    if (i < 0) return 'Someone already took that picture down';
    const { id: _, by, at, ...placement } = this.items[i];
    const p = sanitizePlacement({ ...placement, ...(patch && typeof patch === 'object' ? patch : {}) });
    if (typeof p === 'string') return p;
    this.items[i] = { ...p, id, by, at };
    this.save();
    return this.items[i];
  }

  remove(id: string): Decoration | undefined {
    const i = this.items.findIndex((d) => d.id === id);
    if (i < 0) return undefined;
    const [d] = this.items.splice(i, 1);
    this.save();
    return d;
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Decoration>[];
      for (const s of Array.isArray(saved) ? saved : []) {
        const p = sanitizePlacement(s);
        if (typeof p === 'string' || typeof s.id !== 'string') continue;
        this.items.push({ ...p, id: s.id, by: typeof s.by === 'string' ? s.by : '?', at: typeof s.at === 'number' ? s.at : Date.now() });
      }
    } catch {
      // a broken file just means bare walls
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.items, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}

// ---- Image proxy ------------------------------------------------------------------------------
// Browsers only let WebGL draw an image from another site when that site sends CORS headers, and
// most don't. So the office fetches pictures itself and serves them from its own origin. It only
// does this for signed-in people, who can already run any command on this machine from a shell
// worker, so fetching a link for them gives them nothing new.

export type ImageResult = { type: string; body: Buffer } | { status: number; error: string };

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const CACHE_BYTES = 96 * 1024 * 1024;
const CACHE_MS = 30 * 60_000;
const TIMEOUT_MS = 12_000;

/** Recognizes common image formats from their first bytes, for hosts that don't say. */
function sniff(b: Buffer): string | undefined {
  const at = (i: number, s: string) => b.subarray(i, i + s.length).toString('latin1') === s;
  if (at(0, '\x89PNG')) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (at(0, 'GIF8')) return 'image/gif';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (at(4, 'ftypavif') || at(4, 'ftypavis')) return 'image/avif';
  if (at(0, 'BM')) return 'image/bmp';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon';
  const head = b.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return undefined;
}

export class ImageProxy {
  private cache = new Map<string, { type: string; body: Buffer; at: number }>();
  private bytes = 0;
  private inflight = new Map<string, Promise<ImageResult>>();

  get(raw: string): Promise<ImageResult> {
    const checked = checkImageUrl(raw);
    if ('error' in checked) return Promise.resolve({ status: 400, error: checked.error });
    const url = checked.url;
    const hit = this.cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      // Most recently used goes to the back, so eviction takes the stalest first.
      this.cache.delete(url);
      this.cache.set(url, hit);
      return Promise.resolve(hit);
    }
    let p = this.inflight.get(url);
    if (!p) {
      p = this.fetch(url).finally(() => this.inflight.delete(url));
      this.inflight.set(url, p);
    }
    return p;
  }

  private async fetch(url: string): Promise<ImageResult> {
    const host = new URL(url).host;
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
          'user-agent': 'Mozilla/5.0 (compatible; agent-office; +https://github.com/AgentSystemLabs/agent-office)',
        },
      });
    } catch (err) {
      const e = err as Error & { cause?: { code?: string } };
      if (e.name === 'TimeoutError') return { status: 504, error: `${host} took too long to answer` };
      return { status: 502, error: `Couldn't reach ${host}${e.cause?.code ? ` (${e.cause.code})` : ''}` };
    }
    if (!res.ok) {
      void res.body?.cancel().catch(() => {});
      return { status: 502, error: `${host} answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}` };
    }
    let type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (type === 'text/html' || type === 'application/xhtml+xml') {
      void res.body?.cancel().catch(() => {});
      return { status: 415, error: 'That link is a web page, not an image. Right-click the picture and choose “Copy image address”.' };
    }
    if (Number(res.headers.get('content-length')) > MAX_IMAGE_BYTES) {
      void res.body?.cancel().catch(() => {});
      return { status: 413, error: 'That image is over 15 MB. Try a smaller one.' };
    }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      const reader = res.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_IMAGE_BYTES) {
          await reader.cancel().catch(() => {});
          return { status: 413, error: 'That image is over 15 MB. Try a smaller one.' };
        }
        chunks.push(Buffer.from(value));
      }
    } catch {
      return { status: 502, error: `${host} stopped sending the image halfway` };
    }
    const body = Buffer.concat(chunks);
    if (!type.startsWith('image/')) {
      const sniffed = sniff(body);
      if (!sniffed) return { status: 415, error: `That link isn't an image${type ? ` (it's ${type})` : ''}` };
      type = sniffed;
    }
    const entry = { type, body, at: Date.now() };
    const old = this.cache.get(url);
    if (old) this.bytes -= old.body.length;
    this.cache.delete(url);
    this.cache.set(url, entry);
    this.bytes += body.length;
    for (const [k, v] of this.cache) {
      if (this.bytes <= CACHE_BYTES) break;
      this.cache.delete(k);
      this.bytes -= v.body.length;
    }
    return entry;
  }
}
