import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Session } from '../auth.js';
import type { DevApkView } from '../../shared/dev-apk.js';
import { BuildError, configFor, type DevApkConfig } from './config.js';
import { activeJob, atomic, jobDir, projectFor, publicJob, readJson, release, reserve, rootFor, saveJob, type Job } from './storage.js';
export const canBuild = (s: Session, c: DevApkConfig) => !s.account || s.account.role === 'admin' || !!c.builders?.includes(s.account.id);
export function latest(root: string, project: string) {
  const index = readJson<{ id: string }>(path.join(root, project, 'latest.json'));
  return index ? readJson<Job>(path.join(jobDir(root, project, index.id), 'job.json')) : undefined;
}
function tail(file: string) {
  if (!existsSync(file)) return '';
  const fd = openSync(file, 'r');
  try { const length = statSync(file).size, buffer = Buffer.alloc(Math.min(length, 16000)); readSync(fd, buffer, 0, buffer.length, length - buffer.length); return buffer.toString('utf8'); }
  finally { closeSync(fd); }
}
export function view(dataDir: string, repo: string | undefined, session: Session): DevApkView {
  const c = configFor(dataDir, repo); if (!c) return { configured: false, canBuild: false };
  const root = rootFor(dataDir), project = projectFor(c.repo), active = activeJob(root);
  const recent = readJson<{ id: string }>(path.join(root, project, 'recent.json'));
  const current = recent && readJson<Job>(path.join(jobDir(root, project, recent.id), 'job.json'));
  if (current && ['waiting', 'starting'].includes(current.status)) {
    const phase = path.join(jobDir(root, project, current.id), 'phase.txt');
    if (existsSync(phase)) { const p = readFileSync(phase, 'utf8').trim().replace(/^\uFEFF/, ''); if (['waiting', 'building', 'publishing'].includes(p)) current.status = p as Job['status']; }
  }
  if (current && !current.revision) {
    const revision = path.join(jobDir(root, project, current.id), 'revision.txt');
    if (existsSync(revision)) current.revision = readFileSync(revision, 'utf8').trim().replace(/^\uFEFF/, '');
  }
  return { configured: true, canBuild: canBuild(session, c), ref: c.ref, latest: publicJob(latest(root, project)), current: publicJob(current), busy: !!active,
    log: current ? tail(path.join(jobDir(root, project, current.id), 'build.log')) : '' };
}
export function start(dataDir: string, repo: string | undefined, session: Session, launch = launchRunner) {
  const config = configFor(dataDir, repo); if (!config) throw new BuildError('Für dieses Projekt ist noch kein Dev-Build eingerichtet.', 404);
  if (!canBuild(session, config)) throw new BuildError('Nur freigeschaltete Build-Nutzer dürfen einen Build starten.', 403);
  if (!existsSync(path.join(config.sourceDir, 'Tools', 'Build-Quest.ps1')) || !existsSync(path.join(config.sourceDir, 'Tools', 'BuildLock.ps1'))) throw new BuildError('Der konfigurierte Quest-Build-Ablauf fehlt auf dem Server.', 503);
  const root = rootFor(dataDir), project = projectFor(config.repo);
  const job: Job = { id: randomUUID(), project, config, ref: config.ref, pid: process.pid, status: 'starting', startedAt: Date.now(), requestedBy: session.account?.name ?? 'Office' };
  reserve(root, job);
  try {
    saveJob(root, job); atomic(path.join(root, project, 'recent.json'), { id: job.id });
    launch(root, job);
  } catch (e) { job.status = 'failed'; job.error = (e as Error).message; job.finishedAt = Date.now(); saveJob(root, job); release(root, job.id); throw e; }
  return publicJob(job);
}
function launchRunner(root: string, job: Job) {
  const file = fileURLToPath(new URL('./runner.js', import.meta.url));
  if (!existsSync(file)) throw new BuildError('Office zuerst mit npm run build bauen.', 503);
  const child = spawn(process.execPath, [file, root, job.project, job.id], { detached: true, windowsHide: true, stdio: 'ignore' });
  if (child.pid) atomic(path.join(root, 'active.json'), { id: job.id, project: job.project, pid: child.pid });
  child.once('error', error => { job.status = 'failed'; job.error = error.message; job.finishedAt = Date.now(); saveJob(root, job); release(root, job.id); });
  // Only update the lock's PID here; the worker owns subsequent job status writes.
  child.unref();
}
