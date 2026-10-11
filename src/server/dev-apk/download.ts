import type { IncomingMessage, ServerResponse } from 'node:http';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { jobDir, readJson, type Job } from './storage.js';
import { latest } from './manager.js';
import { BuildError } from './config.js';
export function byteRange(header: string, size: number): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return;
  const a = Number(match[1]), b = Number(match[2]);
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return;
  const start = match[1] ? a : Math.max(0, size - b), end = match[1] && match[2] ? Math.min(b, size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : undefined;
}
export async function download(root: string, project: string, id: string | null, req: IncomingMessage, res: ServerResponse) {
  const job = id ? readJson<Job>(path.join(jobDir(root, project, id), 'job.json')) : latest(root, project);
  if (!job || job.status !== 'ready' || !job.sha256 || !job.bytes) throw new BuildError('Noch keine erfolgreiche APK vorhanden.', 404);
  const file = await open(path.join(jobDir(root, project, job.id), 'app.apk'), 'r').catch(() => { throw new BuildError('Dieser ältere Download ist nicht mehr vorhanden.', 410); });
  try {
    const stat = await file.stat(); if (stat.size !== job.bytes) throw new BuildError('APK-Prüfung fehlgeschlagen.', 503);
    const etag = `"${job.sha256}"`, modified = new Date(job.finishedAt!).toUTCString();
    let range;
    const ifRange = req.headers['if-range'];
    if (req.headers.range && (!ifRange || ifRange === etag || ifRange === modified)) {
      range = byteRange(req.headers.range, stat.size);
      if (!range) { res.writeHead(416, { 'content-range': `bytes */${stat.size}` }).end(); return; }
    }
    const headers: Record<string, string> = { 'content-type': 'application/vnd.android.package-archive',
      'content-disposition': `attachment; filename="dev-${job.revision?.slice(0, 12) ?? job.id}.apk"`,
      'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no',
      'accept-ranges': 'bytes', etag, 'last-modified': modified,
      'content-length': String(range ? range.end - range.start + 1 : stat.size) };
    if (range) headers['content-range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    await pipeline(file.createReadStream({ ...range, autoClose: false }), res);
  } finally { await file.close(); }
}
