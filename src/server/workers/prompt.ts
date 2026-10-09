import type { Worker } from './types.js';

/** Submit once, after the provider's paste debounce. Never send Enter to a replacement process. */
export function submitPrompt(w: Pick<Worker, 'pty'>, text: string, delay = 120): void {
  const pty = w.pty;
  if (!pty) return;
  pty.write(`\x1b[200~${text}\x1b[201~`);
  setTimeout(() => { if (w.pty === pty) pty.write('\r'); }, delay);
}
