import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import type { Ctx } from '../office/context.js';

export const identifier = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(v);
export const requestId = (v: unknown): v is string => typeof v === 'string' && /^tg-[0-9]{1,20}$/.test(v);
export const MAX_EXPORT = 8 * 1024 * 1024;
const exportNames = /^(report|review|copy|strategy|delivery-notes|export-manifest|sources|design-review-v[0-9]+|feed-1080x1350|preview-mobile360|feed-editable)\.(md|json|png|svg|pdf)$/;

export function equalSecret(actual: unknown, expected: string | undefined): boolean {
  if (typeof actual !== 'string' || !expected || expected.length < 32) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** No public HTTP client can use the local connector API, even with a proxy header. */
export function localRequest(address: string | undefined, origin: string | undefined): boolean {
  return !origin && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '');
}

export function target(ctx: Ctx) {
  const id = process.env.AGENT_OFFICE_TELEGRAM_LEADER_ID;
  const floor = id ? ctx.workerFloor(id) : undefined;
  const worker = id ? floor?.workers.get(id) : undefined;
  if (!floor || !worker || worker.kind !== 'agent') throw new Error('Configured Telegram leader is unavailable');
  return { floor, worker };
}

/** Only named campaign exports, never assets, sign-ins, hooks, or arbitrary files. */
export function exportPath(relative: unknown): string {
  if (typeof relative !== 'string' || relative.includes('\\')) throw new Error('Invalid export path');
  const p = relative.split('/');
  if (p.length < 7 || p[0] !== '.agent-office' || p[1] !== 'artiq-studio' || p[2] !== 'brands' || !identifier(p[3])) throw new Error('Export outside brand namespace');
  if (!['reports', 'results'].includes(p[4]) || !identifier(p[5])) throw new Error('Export outside campaign');
  if (p[4] === 'results' ? p.length !== 8 || !/^v[0-9]{2,}$/.test(p[6]) : p.length !== 7) throw new Error('Invalid campaign export');
  if (!exportNames.test(p.at(-1)!)) throw new Error('File is not an allowed export');
  return relative;
}

export async function safeFile(root: string, relative: string, limit = MAX_EXPORT): Promise<Buffer> {
  const base = await fs.realpath(root);
  const parts = relative.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..')) throw new Error('Invalid file path');
  let file = base;
  for (const part of parts) {
    file = path.join(file, part);
    if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('Symlink exports are forbidden');
  }
  const real = await fs.realpath(file);
  if (!real.startsWith(base + path.sep)) throw new Error('Export outside project');
  const handle = await fs.open(real, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('Export is not a file or exceeds size limit');
    const body = await handle.readFile();
    if (body.length > limit) throw new Error('Export exceeds size limit');
    return body;
  } finally { await handle.close(); }
}

export async function readReply(root: string, id: string) {
  if (!requestId(id)) throw new Error('Invalid request ID');
  try {
    const body = await safeFile(root, `.agent-office/telegram/replies/${id}.json`, 32 * 1024);
    const r = JSON.parse(body.toString()) as { text?: unknown; files?: unknown; brand_id?: unknown };
    if (!identifier(r.brand_id) || typeof r.text !== 'string' || !r.text.trim() || r.text.length > 12000) throw new Error('Invalid reply');
    const files = r.files ?? [];
    if (!Array.isArray(files) || files.length > 5) throw new Error('Reply supports at most five exports');
    for (const f of files) {
      const valid = exportPath(f);
      if (valid.split('/')[3] !== r.brand_id) throw new Error('Reply crosses brand boundaries');
    }
    return { brand_id: r.brand_id, text: r.text, files };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

const locks = new Set<string>();

/** Reserve on disk before typing a prompt. A crash is reported as uncertain, never retried blindly. */
export async function dispatch(ctx: Ctx, input: Record<string, unknown>) {
  const { floor, worker } = target(ctx);
  const { id, brand, text } = input;
  if (!requestId(id) || !identifier(brand) || typeof text !== 'string' || !text.trim() || text.length > 12000) throw new Error('Invalid instruction');
  // Unknown brands cannot start production from Telegram.
  await safeFile(floor.dir, `.agent-office/artiq-studio/brands/${brand}/profile.json`, 128 * 1024);
  const key = `${floor.id}/${id}`;
  if (locks.has(key)) return { status: 'uncertain', id };
  locks.add(key);
  try {
    const dir = path.join(floor.dir, '.agent-office/telegram/requests');
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${id}.json`);
    try {
      const h = await fs.open(file, 'wx', 0o600);
      await h.writeFile(JSON.stringify({ id, brand, status: 'dispatching', at: new Date().toISOString() }));
      await h.close();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const prior = JSON.parse((await safeFile(floor.dir, `.agent-office/telegram/requests/${id}.json`, 4096)).toString());
      return { status: prior.status === 'accepted' ? 'accepted' : 'uncertain', id };
    }
    const prompt = [
      `Telegram owner instruction. request_id: ${id}; brand_id: ${brand}.`,
      'Follow the agency policies and active role contracts. Posting remains OFF; a Telegram request is not publication approval.',
      'Do not expose credentials or other brands. Do not send Telegram messages yourself.',
      `Reply by creating .agent-office/telegram/replies/${id}.json in this project with {"brand_id":"${brand}","text":"your reply","files":[]}.`,
      'Files may contain at most five relative campaign export paths under .agent-office/artiq-studio/brands/<brand>/reports or results. Only report.md, review.md, copy.md, strategy.md, sources.json, delivery-notes.md, export-manifest.json, design-review-vNN.md, feed-1080x1350.png, preview-mobile360.png, feed-editable.svg or PDF names with the same stems are allowed.',
      'Preserve artifacts; create the reply only after work is complete. Request clarification for missing campaign or production inputs.',
      'Owner message follows:', text,
    ].join('\n\n');
    let error = floor.workers.prompt(worker.id, prompt, 'Telegram owner');
    if (error === 'Worker is not running') error = floor.workers.resume(worker.id, prompt);
    const status = error ? 'failed' : 'accepted';
    await fs.writeFile(file, JSON.stringify({ id, brand, status, at: new Date().toISOString() }), { mode: 0o600 });
    if (error) throw new Error(error);
    return { status, id };
  } finally { locks.delete(key); }
}
