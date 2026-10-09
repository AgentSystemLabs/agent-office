import type { WorkerHandle } from '../workers/types.js';

/** Recover a missed hook from Codex's live footer. History and plain model prose are not signals. */
export function observeCodexScreen(h: WorkerHandle, text: string): void {
  if (!h.running) return;
  const footer = text.trimEnd().split('\n').slice(-18).join('\n');
  if (/Press enter to confirm or esc to cancel/.test(footer) && /Yes, proceed \(y\)/.test(footer)) {
    if (h.info.status !== 'needs_input') {
      h.info.activity = 'Codex needs permission — open the terminal to answer';
      h.setStatus('needs_input');
    }
  } else if (/^[\s•]*Working \([^\n]*esc to interrupt\)/m.test(footer)) {
    if (h.info.status !== 'working') {
      h.bootBlocked = false;
      h.info.activity = undefined;
      h.setStatus('working');
    }
  } else if (/^\s*Worked for [^\n]+ • \d{1,2}:\d{2}\s*\n\s*› Ask Codex to do anything/m.test(footer)
    && ['working', 'needs_input'].includes(h.info.status)) {
    h.info.activity = undefined;
    h.setStatus('done');
  } else if (h.bootBlocked && /› Ask Codex to do anything/.test(footer) && /GPT-\S+\s+\w+\s+·/.test(footer)) {
    h.bootBlocked = false;
    h.info.activity = undefined;
    h.setStatus('idle');
  }
}
