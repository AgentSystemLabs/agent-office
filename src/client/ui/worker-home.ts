import type { ClientMsg } from '../../shared/protocol';
import { workerOpenWork, type OpenWork } from '../../shared/worker-open-work';
import { store } from '../state';
import { h, openModal, toast } from './dom';

type SendHome = Extract<ClientMsg, { t: 'worker.kill' }>;

/** Shared by desk actions, the queue and the lite view; called after the ordinary cleanup choice. */
export function requestWorkerHome(net: { send(msg: ClientMsg): void }, message: SendHome) {
  const floor = store.floor;
  const current = () => {
    const worker = store.workers.get(message.workerId);
    return worker && store.floor === floor ? worker : undefined;
  };
  const worker = current();
  if (!worker) return;
  const snapshot = () => {
    const w = current();
    return w ? workerOpenWork(w, store.queue.tasks, store.issues.items, store.pulls.items) : [];
  };
  const confirm = (work: OpenWork[]): void => {
    const proceed = (): void => {
      if (!current()) {
        toast('This worker is no longer on this floor.', 'warn');
        return;
      }
      const latest = snapshot();
      if (latest.some((item) => !work.some((shown) => shown.key === item.key && shown.label === item.label))) return confirm(latest);
      net.send(message);
    };
    if (!work.length) return proceed();
    workerHomeWarning(worker.name, work, proceed);
  };
  confirm(snapshot());
}

/** Cancel, Esc and the top-right close button all leave the worker and its work untouched. */
export function workerHomeWarning(name: string, work: readonly OpenWork[], proceed: () => void) {
  const cancel = h('button.btn', { type: 'button' }, 'Keep worker here');
  const send = h('button.btn.danger', { type: 'button' }, 'Send home anyway');
  const modal = openModal(h('div.modal', { role: 'alertdialog', 'aria-label': `Open work for ${name}`, 'aria-describedby': 'worker-home-consequence' },
    h('header', {}, h('h2', {}, `${name} still has open work`)),
    h('div.body', {},
      h('p', { id: 'worker-home-consequence' }, 'Sending this worker home stops its session. These tasks, issues and PRs stay unresolved; they are not completed, closed, merged or automatically handed to another worker. You will need to continue or requeue the work yourself.'),
      h('ul', { style: 'max-height:35vh;overflow:auto;padding-left:24px' }, ...work.map((item) => h('li', {}, item.label))),
      h('p', {}, 'Your worktree cleanup choice still applies. Keeping the worktree and branch lets you recover unfinished local work.')),
    h('footer', {}, cancel, send)));
  cancel.addEventListener('click', () => modal.close());
  send.addEventListener('click', () => { modal.close(); proceed(); }, { once: true });
  cancel.focus();
}
