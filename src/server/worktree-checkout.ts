import { execFile, spawn } from 'node:child_process';

/** Async checkout: keep HTTP, sockets and worker hooks responsive while Git materializes large assets. */
export function checkoutWorktree(cwd: string, args: string[], signal?: AbortSignal): Promise<void> {
  return runCheckout('git', args, cwd, signal, 20 * 60_000);
}

/** Exported separately so timeout and event-loop behavior can be checked without a huge repository. */
export function runCheckout(file: string, args: string[], cwd: string, signal?: AbortSignal, timeoutMs = 20 * 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Meeting start cancelled')); return; }
    const child = spawn(file, args, { cwd, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    let stderr = '';
    let reason: string | undefined;
    let stopping: Promise<void> | undefined;
    const stop = (why: string) => {
      if (reason) return;
      reason = why;
      const pid = child.pid;
      if (!pid) return;
      // Kill only this checkout's process tree, including Git LFS. Killing just the wrapper on
      // Windows leaves git.exe/reset/filter-process copying files after the UI reports failure.
      stopping = new Promise<void>((done) => {
        if (process.platform === 'win32') execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => done());
        else { try { process.kill(-pid, 'SIGKILL'); } catch { /* already exited */ } done(); }
      });
    };
    const abort = () => stop('Meeting start cancelled');
    const timer = setTimeout(() => stop(`Git checkout timed out after ${Math.round(timeoutMs / 1000)} seconds`), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-32_768); });
    child.once('error', (err) => { cleanup(); reject(err); });
    child.once('close', async (code) => {
      cleanup();
      await stopping;
      if (reason) { reject(new Error(reason)); return; }
      if (code === 0) { resolve(); return; }
      const lines = stderr.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
      const detail = lines.find((s) => /^(fatal|error):/i.test(s)) ?? lines.filter((s) => !/^Updating files:/.test(s)).at(-1);
      reject(new Error(detail || `Git checkout exited with code ${code}`));
    });
  });
}
