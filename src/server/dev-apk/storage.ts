import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ApkKind, DevApkBuild } from '../../shared/dev-apk.js';
import type { DevApkConfig } from './config.js';
import { BuildError } from './config.js';
export interface Job extends DevApkBuild { config: DevApkConfig; pid: number; project: string }
export const rootFor = (dir: string) => path.join(dir, 'dev-apk');
// Keep legacy development indexes and links valid; Store never falls back to them.
export const kindOf = (job: DevApkBuild): ApkKind => job.kind ?? 'development';
export const indexFile = (name: 'latest' | 'recent', kind: ApkKind) => kind === 'store' ? `${name}-store.json` : `${name}.json`;
export const projectFor = (repo: string) => createHash('sha256').update(repo.toLowerCase()).digest('hex').slice(0, 24);
export const jobDir = (root: string, project: string, id: string) => {
  if (!/^[a-f0-9]{24}$/.test(project) || !/^[a-f0-9-]{36}$/.test(id)) throw new BuildError('Ungültiger Build.', 404);
  return path.join(root, project, id);
};
export const readJson = <T>(file: string): T | undefined => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
export function atomic(file: string, data: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  writeFileSync(temp, JSON.stringify(data), { mode: 0o600 }); renameSync(temp, file);
}
export function saveJob(root: string, job: Job) { atomic(path.join(jobDir(root, job.project, job.id), 'job.json'), job); }
export function publicJob(job?: Job): DevApkBuild | undefined {
  if (!job) return;
  const { config: _, pid: __, project: ___, ...info } = job; return info;
}
export const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
export function activeJob(root: string): Job | undefined {
  const active = readJson<{ project: string; id: string; pid: number }>(path.join(root, 'active.json'));
  if (!active) return;
  const file = path.join(jobDir(root, active.project, active.id), 'job.json');
  const job = readJson<Job>(file);
  if (alive(active.pid)) return job;
  if (job && !['ready', 'failed', 'interrupted'].includes(job.status)) {
    job.status = 'interrupted'; job.finishedAt = Date.now(); job.error = 'Build-Begleiter wurde beendet. Letzter erfolgreicher Download bleibt erhalten.'; saveJob(root, job);
  }
  release(root, active.id); return;
}
export function reserve(root: string, job: Job) {
  mkdirSync(root, { recursive: true });
  activeJob(root);
  try { const fd = openSync(path.join(root, 'active.json'), 'wx'); try { writeFileSync(fd, JSON.stringify({ id: job.id, project: job.project, pid: job.pid })); } finally { closeSync(fd); } }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new BuildError('Ein APK-Build läuft bereits. Bitte dessen Abschluss abwarten.', 409); throw e; }
}
export function release(root: string, id: string) {
  const file = path.join(root, 'active.json');
  if (readJson<{ id: string }>(file)?.id === id) unlinkSync(file);
}
