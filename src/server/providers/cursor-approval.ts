import type { WorkerHandle } from '../workers/types.js';

const pending = new WeakSet<WorkerHandle>();
const activity = 'Cursor needs permission — open the terminal to answer';

/** Require the interactive footer, not the tool's historical "Waiting for approval" line. */
export function cursorApproval(text: string): boolean {
  const footer = text.trimEnd().split('\n').slice(-12).join(' ');
  return /Run this command\?/i.test(footer)
    && /Run\s*\(once\)\s*\(y\)/i.test(footer)
    && /Skip & tell the agent what to do instead\s*\(esc or n\)/i.test(footer);
}

export function observeCursorApproval(h: WorkerHandle, text: string): void {
  if (!h.running || !['working', 'needs_input', 'idle'].includes(h.info.status)) {
    pending.delete(h);
    return;
  }
  if (cursorApproval(text)) {
    if (h.info.status !== 'needs_input') {
      pending.add(h);
      h.info.activity = activity;
      h.setStatus('needs_input');
    }
  } else if (pending.delete(h) && h.info.status === 'needs_input' && h.info.activity === activity) {
    h.info.activity = undefined;
    h.setStatus('working');
  }
}
