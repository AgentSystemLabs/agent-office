import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, existsSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomic, jobDir, readJson, release, saveJob, type Job } from './storage.js';
import { buildScript } from './powershell.js';
export async function publish(root: string, job: Job) {
  const dir = jobDir(root, job.project, job.id), part = path.join(dir, 'app.apk.part');
  const stream = createReadStream(part); const hash = createHash('sha256'); let first = true;
  for await (const chunk of stream) {
    const bytes = chunk as Buffer;
    if (first && (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50)) throw new Error('Build hat keine APK-Datei erzeugt.');
    first = false; hash.update(bytes);
  }
  if (first) throw new Error('Leere APK.');
  job.bytes = statSync(part).size; job.sha256 = hash.digest('hex');
  job.revision = readFileSync(path.join(dir, 'revision.txt'), 'utf8').trim().replace(/^\uFEFF/, '');
  if (!/^[a-f0-9]{40}$/.test(job.revision)) throw new Error('Build-Revision fehlt.');
  renameSync(part, path.join(dir, 'app.apk'));
  job.status = 'ready'; job.finishedAt = Date.now(); saveJob(root, job);
  atomic(path.join(root, job.project, 'latest.json'), { id: job.id });
  // Keep the last three successful APKs. Never unlink a file being streamed on Windows.
  const ready = readdirSync(path.join(root, job.project)).filter(id => /^[a-f0-9-]{36}$/.test(id))
    .map(id => readJson<Job>(path.join(jobDir(root, job.project, id), 'job.json'))).filter(j => j?.status === 'ready') as Job[];
  for (const old of ready.sort((a, b) => b.finishedAt! - a.finishedAt!).slice(3)) {
    try { unlinkSync(path.join(jobDir(root, old.project, old.id), 'app.apk')); } catch { /* Retry retention after the next successful build. */ }
  }
}
export async function run(root: string, project: string, id: string) {
  const dir = jobDir(root, project, id), job = readJson<Job>(path.join(dir, 'job.json'))!;
  job.pid = process.pid; job.status = 'waiting'; saveJob(root, job);
  const log = openSync(path.join(dir, 'build.log'), 'a');
  try {
    if (process.platform !== 'win32') throw new Error('Der konfigurierte Quest-Build benötigt einen Windows-Build-Rechner.');
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(buildScript, 'utf16le').toString('base64')], {
        windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, OFFICE_DEV_APK_JOB: path.join(dir, 'job.json') },
      });
      child.once('error', reject); child.once('exit', resolve);
    });
    if (code !== 0) throw new Error('Dev-Build fehlgeschlagen. Details im Build-Protokoll.');
    await publish(root, job);
  } catch (error) {
    job.status = 'failed'; job.finishedAt = Date.now(); job.error = (error as Error).message; saveJob(root, job);
    const part = path.join(dir, 'app.apk.part'); if (existsSync(part)) unlinkSync(part);
  } finally { closeSync(log); release(root, id); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run(process.argv[2], process.argv[3], process.argv[4]);
}
