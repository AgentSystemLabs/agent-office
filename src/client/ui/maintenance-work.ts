import type { MaintenanceAttachment, ClientMsg, MaintenanceChatState, MaintenanceWorkItem } from '../../shared/protocol';
import { store } from '../state';
import { h, openModal } from './dom';
import { maintenanceJson, openMaintenanceIssue } from './maintenance-board';
import { imageComposer, imageEvidence } from './maintenance-images';
import { openStackChange } from './maintenance';

export async function maintenancePost<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

export function openMaintenanceIssueCreate(saved: () => void) {
  const title = h('input', { type: 'text', maxlength: 200, placeholder: 'What should we improve?', 'aria-label': 'Issue title', required: true });
  const description = h('textarea', { rows: 6, maxlength: 20000, placeholder: 'Describe the problem, expected behavior and useful context…', 'aria-label': 'Issue description' });
  const error = h('p.maintenance-chat-error.hidden', { role: 'alert' });
  const showError = (text: string) => { error.textContent = text; error.classList.toggle('hidden', !text); };
  let sending = false;
  let completed = false;
  const draftKey = 'agent-office.maintenance-issue-draft-v1';
  const save = () => { if (completed) return; try { localStorage.setItem(draftKey, JSON.stringify({ title: title.value, body: description.value, attachments: images.images, queue: queue.checked })); } catch { /* Storage unavailable. */ } };
  const submit = h('button.btn.primary', { type: 'submit' }, 'Create GitHub issue & queue');
  const images = imageComposer(() => { save(); submit.disabled = sending || images.uploading; }, showError);
  const queue = h('input', { type: 'checkbox', checked: true });
  const updateLabel = () => { submit.textContent = queue.checked ? 'Create GitHub issue & queue' : 'Create GitHub issue'; };
  queue.addEventListener('change', () => { updateLabel(); save(); });
  title.addEventListener('input', save); description.addEventListener('input', save);
  try { const draft = JSON.parse(localStorage.getItem(draftKey) ?? 'null'); if (draft) { title.value = typeof draft.title === 'string' ? draft.title : ''; description.value = typeof draft.body === 'string' ? draft.body : ''; queue.checked = draft.queue !== false; images.set(Array.isArray(draft.attachments) ? draft.attachments.filter((i: MaintenanceAttachment) => i && /^[a-f0-9-]{36}$/.test(i.id)) : []); updateLabel(); } } catch { /* Storage unavailable. */ }
  const form = h('form.modal.maintenance-issue-create', { role: 'dialog', 'aria-label': 'Create maintenance issue' },
    h('header', {}, h('h2', {}, 'Capture an idea')),
    h('div.body', {}, h('p', {}, `Creates an issue in ${store.maintenanceIssues.repo ?? 'Agent Office’s repository'}. Maintenance keeps working on its current task.`), error, title, description, images.element,
      h('label', {}, queue, ' Add to the Maintenance queue'), h('p.setting-note', {}, 'Start queued work when the agent is free. Screenshots stay with the queued item in the office; they are not published to GitHub.')),
    h('footer', {}, submit));
  images.bind(form);
  const modal = openModal(form, { onClose: save });
  form.addEventListener('submit', e => {
    e.preventDefault(); if (sending || images.uploading || !title.value.trim()) return;
    if (!queue.checked && images.images.length) { showError('Keep “Add to the Maintenance queue” checked to retain screenshot evidence with this issue.'); return; }
    sending = true; submit.disabled = true; title.disabled = description.disabled = queue.disabled = true; images.disable(true); showError('');
    void maintenancePost('/api/maintenance/issue', { title: title.value, body: description.value, queue: queue.checked, attachments: images.images.map(i => i.id) })
      .then(() => { completed = true; try { localStorage.removeItem(draftKey); } catch { /* Storage unavailable. */ } modal.close(); saved(); })
      .catch(err => { showError(err.message); sending = false; submit.disabled = false; title.disabled = description.disabled = queue.disabled = false; images.disable(false); });
  });
  title.focus(); return modal;
}

export function workPanel(state: MaintenanceChatState, send: (message: ClientMsg) => void, start: (item: MaintenanceWorkItem) => void, correct: (context?: string) => void, refresh: () => void, viewConversation: (id: string) => void) {
  const panel = h('div.maintenance-work-panel');
  const github = store.maintenanceIssues;
  const error = h('p.maintenance-chat-error.hidden', { role: 'alert' });
  const act = (promise: Promise<unknown>) => void promise.then(refresh).catch(err => { error.textContent = err.message; error.classList.remove('hidden'); });
  const work = state.work ?? [];
  const queued = work.filter(i => i.status === 'queued');
  const busy = !!state.worker && !['idle', 'done', 'exited'].includes(state.worker.status);
  const startNext = h('button', { type: 'button', disabled: busy || !queued.length || work.some(i => i.status === 'running') || state.stack?.phase === 'shipping' || state.stack?.validation?.phase === 'running', onclick: () => start(queued[0]) }, 'Start next queued issue');
  panel.append(h('div.maintenance-section-heading', {}, h('div', {}, h('h3', {}, 'Engineering backlog'), h('p', {}, `${github.repo ?? 'Agent Office'} · GitHub issues + shared office queue`)),
    h('button', { type: 'button', onclick: () => openMaintenanceIssueCreate(refresh) }, '+ Add issue')), error,
    h('div.maintenance-work-intro', {}, startNext, h('p', {}, busy ? 'The agent is busy. Capture or queue ideas now; start the next issue after it finishes.' : 'Queued issues wait for you to start them. Each starts a fresh session on the same stack.')));
  for (const [status, title] of [['running', 'In progress'], ['queued', 'Queued'], ['review', 'Ready for review'], ['paused', 'Interrupted'], ['done', 'Reviewed']] as const) {
    const items = work.filter(i => i.status === status);
    if (!items.length && status !== 'queued') continue;
    panel.append(h('h4', {}, `${title} · ${items.length}`));
    for (const item of items) {
      const card = h('article.maintenance-work-card', {}, h('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer' }, `#${item.number} · ${item.title}`), h('small', {}, `Added by ${item.by}`));
      if (item.workerId) card.append(h('button', { type: 'button', onclick: () => viewConversation(item.workerId!) }, 'Conversation'));
      if (status === 'review') card.append(h('button', { type: 'button', onclick: () => act(maintenancePost('/api/maintenance/queue', { number: item.number, reviewed: true })) }, 'Mark reviewed'));
      if (item.attachments.length) card.append(imageEvidence(item.attachments));
      const issue = github.items.find(i => i.number === item.number);
      if (issue) card.append(h('button', { type: 'button', onclick: () => openMaintenanceIssue(issue, correct, send) }, 'Read issue'));
      if (status !== 'running') card.append(h('button', { type: 'button', onclick: () => act(maintenancePost('/api/maintenance/queue', { number: item.number, ...(status === 'queued' ? { remove: true } : { attachments: item.attachments.map(i => i.id) }) })) }, status === 'queued' ? 'Remove from queue' : 'Queue another pass'));
      for (const commit of item.commits) card.append(h('button', { type: 'button', onclick: () => openStackChange(commit, { correct, watch() {} }) }, `${commit.sha} · ${commit.subject}`));
      if (status === 'review' && !item.commits.length) card.append(h('p', {}, 'The agent’s turn ended. Review its response and working edits; no stacked commit is linked yet.'));
      panel.append(card);
    }
    if (!items.length) panel.append(h('p.maintenance-muted', {}, 'Queue an issue below, or capture a new idea.'));
  }
  panel.append(h('div.maintenance-section-heading', {}, h('h4', {}, 'Open GitHub issues'), h('button', { type: 'button', onclick: () => send({ t: 'maintenance.issues' }) }, 'Refresh issues')));
  if (github.error) panel.append(h('p.maintenance-chat-error', { role: 'alert' }, github.error),
    ...(github.repo ? [h('a', { href: `https://github.com/${github.repo}/settings`, target: '_blank', rel: 'noopener noreferrer' }, 'Repository settings ↗')] : []));
  for (const issue of github.items.filter(i => i.state === 'OPEN')) {
    const inQueue = work.some(i => i.number === issue.number && ['queued', 'running'].includes(i.status));
    panel.append(h('article.maintenance-work-card', {}, h('button.maintenance-issue-title', { type: 'button', onclick: () => openMaintenanceIssue(issue, correct, send) }, `#${issue.number} · ${issue.title}`),
      h('button', { type: 'button', disabled: inQueue, onclick: () => act(maintenancePost('/api/maintenance/queue', { number: issue.number })) }, inQueue ? 'In maintenance queue' : 'Queue for Maintenance')));
  }
  if (!github.loading && !github.items.some(i => i.state === 'OPEN') && !github.error) panel.append(h('p.maintenance-muted', {}, 'No open issues. Add an idea to build the backlog.'));
  return panel;
}
