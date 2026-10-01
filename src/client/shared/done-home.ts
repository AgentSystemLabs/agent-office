/**
 * 🏠 Everyone done goes home: one button beside the "✅ done" count, in the 3D office's Workers panel
 * and the 2D view's, that sends every worker that finished home at once. Each goes as if sent home
 * with no choice made (see Floor.sendHome): its worktree and branch are deleted unless they hold work
 * that isn't on GitHub. No three.js here: the 2D view imports it.
 */
import type { Net } from '../net';
import { DESK_BY_ID } from '../../shared/layout';
import type { WorkerInfo } from '../../shared/protocol';
import { h } from '../ui/dom';
import { confirmDialog } from '../ui/prompt';
import './done-home.css';

/** The workers that are done and free to go: agents, not at the meeting table or a board. */
export function doneWorkers(workers: Iterable<WorkerInfo>): WorkerInfo[] {
  return [...workers].filter((w) => w.status === 'done' && w.kind === 'agent' && !w.meeting && !DESK_BY_ID.get(w.deskId)?.station);
}

/** "Ada", "Ada and Bo", "Ada, Bo and Cy". */
function names(list: WorkerInfo[]): string {
  const n = list.map((w) => w.name);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0];
}

/** Asks once, then sends each of them home. */
export function sendDoneHome(net: Net, list: WorkerInfo[]) {
  if (!list.length) return;
  const one = list.length === 1;
  confirmDialog(
    one ? `Send ${list[0].name} home?` : `Send all ${list.length} done workers home?`,
    `${names(list)} ${one ? 'is' : 'are'} done. ${one ? 'Its' : 'Each one’s'} worktree and branch are deleted, unless they hold work that isn’t on GitHub.`,
    '🏠 Send home',
    () => {
      for (const w of list) net.send({ t: 'worker.kill', workerId: w.id });
    },
  );
}

/** The button, and what keeps it up to date: call `render` whenever the workers change. */
export function doneHomeButton(net: Net, workers: () => Iterable<WorkerInfo>) {
  const el = h('button.btn.done-home.hidden', { type: 'button', title: 'Send every worker that is done home at once' }) as HTMLButtonElement;
  el.addEventListener('click', () => {
    sendDoneHome(net, doneWorkers(workers()));
    setTimeout(() => el.blur(), 0);
  });
  function render() {
    const n = doneWorkers(workers()).length;
    el.classList.toggle('hidden', !n);
    el.textContent = n === 1 ? '🏠 Send the done one home' : `🏠 Send all ${n} done home`;
  }
  render();
  return { el, render };
}
