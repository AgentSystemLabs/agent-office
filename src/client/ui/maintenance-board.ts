import type { ClientMsg, GhIssue, GhIssueDetail } from '../../shared/protocol';
import { MAINTENANCE_DESK } from '../../shared/layout';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import { maintenancePost, openMaintenanceIssueCreate } from './maintenance-work';
import { markdown } from './markdown';

export async function maintenanceJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data as T;
}

export { maintenanceIssueColumns } from '../../shared/maintenance-issues';
import { maintenanceIssueColumns } from '../../shared/maintenance-issues';

/** Office source issues have no floor queue, carried cards or floor-worker actions. */
export function openMaintenanceIssue(issue: GhIssue, correct: (context?: string) => void, send?: (msg: ClientMsg) => void) {
  const body = h('div.body', {}, h('p', {}, 'Loading issue and comments…'));
  const modal = openModal(h('div.modal.maintenance-issue', { role: 'dialog', 'aria-label': 'Agent Office issue' },
    h('header', {}, h('h2', {}, `🛠️ Agent Office · #${issue.number}`)), body));
  void maintenanceJson<GhIssueDetail>(`/api/maintenance/issue?number=${issue.number}`).then((detail) => {
    body.replaceChildren(h('h3', {}, issue.title), h('p.setting-note', {}, `${store.maintenanceIssues.repo ?? 'Agent Office source repository'} · ${detail.state}`),
      h('div', {}, markdown(detail.body || '_No description._')),
      h('button.btn.primary', { type: 'button', onclick: () => { modal.close(); correct(`Agent Office issue #${issue.number}: ${issue.title}\n${issue.url}`); } }, '🛠️ Ask Maintenance about this'),
      ...(detail.state === 'OPEN' && send ? [h('button.btn', { type: 'button', onclick: () => { void maintenancePost('/api/maintenance/queue', { number: issue.number }).then(() => { modal.close(); send({ t: 'maintenance.issues' }); }).catch(error => body.append(h('p.setting-note.bad', { role: 'alert' }, error.message))); } }, 'Add to Maintenance queue'), h('button.btn.primary', { type: 'button', onclick: () => { send({ t: 'station.prompt', deskId: MAINTENANCE_DESK, prompt: '', maintenanceIssue: issue.number }); modal.close(); } }, '🚧 Move to In progress & start Maintenance')] : []),
      h('a.btn', { href: issue.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open on GitHub ↗'),
      h('h3', {}, 'Comments'), ...detail.comments.map((comment) => h('section.maintenance-comment', {}, h('strong', {}, `${comment.author} · ${timeAgo(comment.createdAt)}`), markdown(comment.body))),
      ...(detail.comments.length ? [] : [h('p.setting-note', {}, 'No comments yet.')]));
  }).catch((error) => body.replaceChildren(h('p.setting-note.bad', { role: 'alert' }, String(error))));
  return modal;
}

export function openMaintenanceBoard(send: (msg: ClientMsg) => void, correct: (context?: string) => void) {
  const body = h('div.body');
  const status = h('span.board-status');
  const el = h('div.modal.board', { role: 'dialog', 'aria-label': 'Agent Office issues Kanban' },
    h('header', {}, h('h2', {}, '🛠️ Agent Office issues'), status,
      h('button.btn', { type: 'button', onclick: () => openMaintenanceIssueCreate(() => send({ t: 'maintenance.issues' })) }, '+ Add issue'),
      h('button.btn', { type: 'button', onclick: () => send({ t: 'maintenance.issues' }) }, '🔄 Refresh')), body);
  const render = () => {
    const state = store.maintenanceIssues;
    status.textContent = state.loading ? 'Refreshing…' : state.fetchedAt ? `Updated ${timeAgo(state.fetchedAt)}` : '';
    body.replaceChildren();
    const columns = h('div.maintenance-columns');
    body.append(h('p.maintenance-repo', {}, `${state.repo ?? 'Agent Office source repository'} · Shared across every floor`));
    if (state.error) body.append(h('p.setting-note.bad', { role: 'alert' }, state.error));
    for (const column of maintenanceIssueColumns(state.items)) {
      const cards = h('ul');
      column.items.forEach((issue) => cards.append(h('li', {}, h('button.maintenance-note', {
        type: 'button', title: issue.title, style: `background:${['#fff7b0', '#ffd6e0', '#caffbf', '#bde0fe', '#ffe5b4'][issue.number % 5]}`,
        onclick: () => openMaintenanceIssue(issue, correct, send),
      }, h('strong', {}, `#${issue.number}`), h('span', {}, issue.title)))));
      if (!column.items.length) cards.append(h('li.empty', {}, state.loading ? 'Loading…' : 'Nothing here'));
      columns.append(h('section.column', {}, h('h4', {}, `${column.title} · ${column.items.length}`), cards));
    }
    body.append(columns);
  };
  const unsub = store.on('maintenanceIssues', render);
  const modal = openModal(el, { onClose: unsub });
  render();
  send({ t: 'maintenance.issues' });
  return modal;
}
