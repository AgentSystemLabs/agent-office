import type { Worker } from './types.js';
import type { WorkerTasks } from './tasks.js';
import { truncate } from './util.js';

export function sendWorkerPrompt(w: Worker, text: string, by: string | undefined, tasks: WorkerTasks, updated: () => void): string | undefined {
  if (w.dsh) {
      const clean = text.replace(/\r\n?/g, '\n').trim();
      if (!clean) return 'Empty prompt';
      w.dsh.prompt(clean);
      w.info.activity = truncate(clean, 80);
      tasks.notePrompt(w, clean);
      if (by) w.info.lastInput = { by, at: Date.now() };
      updated();
      return undefined;
    }
    if (!w.pty) return 'Worker is not running';
    const clean = text.replace(/\r\n?/g, '\n').trim();
    if (!clean) return 'Empty prompt';
    // Bracketed paste keeps multi-line prompts in one message, then Enter submits.
    const pty = w.pty;
  pty.write(`\x1b[200~${clean}\x1b[201~`);
    setTimeout(() => { if (w.pty === pty) pty.write('\r'); }, 120);
    w.info.activity = truncate(clean, 80);
    tasks.notePrompt(w, clean);
    if (by) w.info.lastInput = { by, at: Date.now() };
    updated();
    return undefined;
}
