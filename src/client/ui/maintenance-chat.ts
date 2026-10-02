import type { ClientMsg, MaintenanceAttachment, MaintenanceChatMessage, MaintenanceChatState, MaintenanceWorkItem, ServerMsg } from '../../shared/protocol';
import { store } from '../state';
import { h, openModal } from './dom';
import { markdown } from './markdown';
import { maintenanceJson } from './maintenance-board';
import { openStackChange, type MaintenanceActions } from './maintenance';
import { confirmDialog } from './prompt';
import { providerPicker, workerChoice } from './provider';
import { imageComposer, imageEvidence } from './maintenance-images';
import { maintenanceConsole } from './maintenance-console';
import { openMaintenanceIssueCreate, workPanel } from './maintenance-work';

type Sent = Extract<ServerMsg, { t: 'maintenance.chat.sent' }>;
const receipts = new Set<(message: Sent) => void>();
export function onMaintenanceChatSent(message: Sent) { receipts.forEach(receive => receive(message)); }

/** HTML keeps its styling in an opaque sandbox; it cannot access the office or fetch resources. */
function htmlPreview(source: string) {
  const frame = h('iframe.maintenance-html', { title: 'Agent HTML preview', sandbox: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) as HTMLIFrameElement;
  frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none';"><style>body{font:15px system-ui;color:#17212f;margin:20px}pre{white-space:pre-wrap}</style>${source}`;
  return h('details.maintenance-preview', {}, h('summary', {}, 'Preview HTML'), frame);
}

export function maintenanceContent(source: string): HTMLElement {
  if (/^\s*(?:<!doctype\s+html|<html[\s>])/i.test(source)) {
    const preview = htmlPreview(source);
    preview.open = true;
    return h('div.maintenance-rich', {}, preview, h('details', {}, h('summary', {}, 'HTML source'), h('pre', {}, h('code', {}, source))));
  }
  const content = markdown(source);
  // Agent text is untrusted. The existing Markdown renderer sanitizes markup and executable URLs.
  for (const code of content.querySelectorAll('pre > code')) {
    if (/\blanguage-html\b/.test(code.className)) code.parentElement!.after(htmlPreview(code.textContent ?? ''));
    const copy = h('button.maintenance-copy', { type: 'button', 'aria-label': 'Copy code' }, 'Copy');
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(code.textContent ?? '').then(() => { copy.textContent = 'Copied'; }, () => { copy.textContent = 'Copy unavailable'; });
    });
    code.parentElement!.append(copy);
  }
  return content;
}

function bubble(message: MaintenanceChatMessage) {
  const user = message.role === 'user';
  return h('article.maintenance-message', { class: user ? 'from-user' : 'from-agent', 'data-message': message.id },
    h('div.maintenance-message-meta', {}, h('b', {}, user ? message.by ?? 'You' : 'Maintenance'),
      h('time', { datetime: new Date(message.at).toISOString() }, new Date(message.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      message.phase === 'commentary' ? h('span', {}, 'Progress') : message.pending ? h('span', {}, 'Accepted · awaiting agent transcript') : null),
    h('div.maintenance-bubble', {}, user ? h('p.maintenance-user-text', {}, message.content) : maintenanceContent(message.content), message.attachments?.length ? imageEvidence(message.attachments) : null));
}

/** A view over the existing Maintenance worker; archived conversations are read-only. */
export function openMaintenanceChat(send: (message: ClientMsg) => void, actions: MaintenanceActions, reviewStack: () => void, initial = '', startNew = false) {
  let closed = false;
  let selected: string | undefined;
  let newConversation = startNew;
  let state: MaintenanceChatState | undefined;
  let generation = 0;
  let messageKey = '';
  let archiveKey = '';
  let historyFailed = false;
  let messages: MaintenanceChatMessage[] = [];
  let pending: { id: string; text: string; attachments: MaintenanceAttachment[]; timer: ReturnType<typeof setTimeout> } | undefined;
  let tab: 'conversation' | 'work' | 'review' = 'conversation';
  let issueStart = false;
  let workKey = '';
  let reviewKey = '';
  let consoleWorker: string | undefined;
  let consoleView: ReturnType<typeof maintenanceConsole> | undefined;
  const draftKey = 'agent-office.maintenance-draft-v1';
  const draftScope = () => newConversation ? 'new' : selected ?? state?.worker?.id ?? 'current';
  let loadedDraft = '';
  let drafts: Record<string, { text: string; attachments: MaintenanceAttachment[] }> = {};
  try { const saved = JSON.parse(localStorage.getItem(draftKey) ?? '{}'); if (saved && typeof saved === 'object' && !Array.isArray(saved)) drafts = saved; } catch { /* Storage unavailable. */ }
  const search = h('input', { type: 'search', placeholder: 'Search conversations', 'aria-label': 'Search Maintenance history' });
  const archive = h('div.maintenance-chat-archive');
  const list = h('div.maintenance-chat-messages', { role: 'log', 'aria-label': 'Maintenance conversation', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  const status = h('span.maintenance-chat-status', {}, 'Connecting…');
  const error = h('p.maintenance-chat-error.hidden', { role: 'alert' });
  const note = h('p.maintenance-composer-note');
  const input = h('textarea', { rows: 2, maxlength: 20000, placeholder: 'Ask Maintenance to build, fix, or explain something…', 'aria-label': 'Message to Maintenance' });
  input.value = initial;
  const images = imageComposer(() => { saveDraft(); updateControls(); }, showError);
  const capture = h('button', { type: 'button', onclick: () => openMaintenanceIssueCreate(() => { send({ t: 'maintenance.issues' }); void refresh(); }) }, '+ Add issue');
  const work = h('div.maintenance-work-view.hidden');
  const review = h('div.maintenance-review-view.hidden');
  const attention = h('div.maintenance-attention.hidden', { role: 'status' });
  const activity = h('p.maintenance-activity');
  const consoleHost = h('div.maintenance-live-console');
  const consoleDetails = h('details.maintenance-console', {}, h('summary', {}, 'Live agent console · prompts, permissions & output'), consoleHost);
  consoleDetails.open = true;
  const consoleRail = h('section.maintenance-console-rail', {}, h('h3', {}, 'Agent control'), activity, attention, consoleDetails);
  const tabs = h('nav.maintenance-tabs', { 'aria-label': 'Maintenance workspace views' });
  for (const [value, label] of [['conversation', 'Conversation'], ['work', 'Work & issues'], ['review', 'Review & checks']] as const) tabs.append(h('button', { type: 'button', 'data-tab': value, onclick: () => selectTab(value) }, label));

  const submit = h('button.maintenance-send', { type: 'submit' }, 'Send');
  const older = h('button.maintenance-older.hidden', { type: 'button' }, 'Load earlier messages');
  const terminal = h('button', { type: 'button', onclick: () => {
    if (state?.worker && state.floor) { modal.close(); actions.watch(state.worker, state.floor); }
  } }, 'Open terminal');
  const end = h('button', { type: 'button', onclick: () => { if (!state?.worker) return; const workerId = state.worker.id; confirmDialog('End Maintenance session?', 'Stops the active session for everyone, including unfinished work. Conversation history, screenshots, edited files and stacked commits remain.', 'End session', () => send({ t: 'worker.kill', workerId })); } }, 'End session');
  const current = h('button.maintenance-current', { type: 'button', onclick: () => { saveDraft(); selectTab('conversation'); newConversation = false; selected = undefined; loadedDraft = ''; messageKey = ''; messages = []; void refresh(); } }, 'Current conversation');
  const create = h('button.maintenance-new', { type: 'button', onclick: () => {
    saveDraft(); selectTab('conversation'); newConversation = true; selected = undefined; loadedDraft = ''; messages = []; messageKey = ''; showError(''); void refresh().then(() => input.focus());
  } }, '+ New conversation');
  // The agent is on what it was hired on, so a request to move it (say, off a model that's out of credits) hires it afresh there.
  const model = providerPicker(store.project, 'maintenance-provider', 'Runs on', () => newConversation ? undefined : workerChoice(state?.worker));
  model.element.addEventListener('click', () => setTimeout(updateControls));
  const form = h('form.maintenance-chat-composer', {}, error, input, images.element, model.element,
    h('div.maintenance-composer-bottom', {}, note, submit));
  const close = h('button.close', { type: 'button', 'aria-label': 'Close Maintenance chat' }, '✕');
  const el = h('div.modal.maintenance-chat', { role: 'dialog', 'aria-label': 'Maintenance engineering workspace' },
    h('header', {}, h('div', {}, h('span.maintenance-experiment', {}, 'AGENT OFFICE · ENGINEERING'), h('h2', {}, 'Maintenance'), status),
      h('div.maintenance-chat-tools', {}, h('button', { type: 'button', onclick: () => { modal.close(); reviewStack(); } }, 'Review stack'), terminal, end, close)),
    h('div.maintenance-chat-layout', {},
      h('aside', {}, capture, create, current, h('h3', {}, 'Conversation archive'), h('small', {}, 'Shared with the office · saved across restarts'), search, archive),
      h('section.maintenance-chat-main', {}, tabs, older, list, work, review, form), consoleRail));
  images.bind(form);
  const modal = openModal(el, { doing: 'chatting with Maintenance', onClose: () => {
    saveDraft();
    closed = true;
    consoleView?.dispose();
    generation++;
    clearInterval(poll);
    if (pending) clearTimeout(pending.timer);
    receipts.delete(receive);
    offWorkers(); offIssues(); offStack();
  } });
  close.addEventListener('click', () => modal.close());

  function showError(text: string) { error.textContent = text; error.classList.toggle('hidden', !text); if (text && tab !== 'conversation') selectTab('conversation'); }
  function drawArchive() {
    if (!state) return;
    const q = search.value.trim().toLowerCase();
    const entries = state.conversations.filter(c => c.title.toLowerCase().includes(q));
    archive.replaceChildren(...entries.map(c => h('button.maintenance-conversation', {
      type: 'button', class: (newConversation ? undefined : selected ?? state?.worker?.id) === c.id ? 'selected' : '',
      'aria-pressed': String((newConversation ? undefined : selected ?? state?.worker?.id) === c.id),
      onclick: () => { saveDraft(); newConversation = false; selected = c.id; loadedDraft = ''; selectTab('conversation'); messages = []; messageKey = ''; void refresh(); },
    }, h('b', {}, c.title), h('small', {}, `${new Date(c.updatedAt).toLocaleDateString()} · ${c.count} messages`))),
    ...(!entries.length ? [h('p.maintenance-archive-empty', {}, q ? 'No matching conversations' : 'Conversations appear here after your first request.')] : []));
  }
  search.addEventListener('input', drawArchive);
  function saveDraft() {
    if (loadedDraft) drafts[loadedDraft] = { text: input.value, attachments: images.images };
    try { localStorage.setItem(draftKey, JSON.stringify(drafts)); } catch { /* Storage unavailable. */ }
  }
  function loadDraft() {
    const scope = draftScope();
    if (loadedDraft === scope) return;
    loadedDraft = scope;
    const draft = drafts[scope];
    input.value = initial || (typeof draft?.text === 'string' ? draft.text : '');
    initial = '';
    images.set(Array.isArray(draft?.attachments) ? draft.attachments.filter(i => i && typeof i.id === 'string' && /^[a-f0-9-]{36}$/.test(i.id)) : []);
  }
  function selectTab(value: typeof tab) {
    tab = value;
    list.classList.toggle('hidden', tab !== 'conversation');
    form.classList.toggle('hidden', tab !== 'conversation');
    work.classList.toggle('hidden', tab !== 'work');
    review.classList.toggle('hidden', tab !== 'review');
    for (const button of tabs.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.tab === value));
    older.classList.toggle('hidden', tab !== 'conversation' || !state?.conversation?.hasOlder);
    if (tab === 'review') void drawReview();
    if (tab === 'work') drawWork();
  }
  function startIssue(item: MaintenanceWorkItem) {
    if (pending) return;
    issueStart = true;
    saveDraft(); showError('');
    const id = crypto.randomUUID();
    pending = { id, text: input.value, attachments: images.images, timer: setTimeout(() => { pending = undefined; showError('No acknowledgement yet. Check the current work before starting again.'); void refresh(); }, 30000) };
    send({ t: 'maintenance.chat.send', id, prompt: '', maintenanceIssue: item.number, newConversation: true });
    updateControls();
  }
  function correctHere(context?: string) {
    saveDraft();
    const scope = state?.worker?.id ?? 'current';
    const saved = drafts[scope]?.text ?? '';
    initial = context ? `${context}\n\n${saved}` : saved;
    newConversation = false; selected = undefined; loadedDraft = ''; messages = []; messageKey = '';
    selectTab('conversation'); void refresh().then(() => { if (!closed) input.focus(); });
  }
  const reviewActions: MaintenanceActions = { ...actions, correct: correctHere };
  function drawWork() {
    if (!state) return;
    const key = JSON.stringify([state.work, state.worker?.status, store.maintenanceIssues, state.stack?.phase, state.stack?.validation?.phase, !!pending]);
    if (key === workKey) return;
    workKey = key;
    work.replaceChildren(workPanel(state, send, item => { if (!pending) startIssue(item); }, correctHere, () => { send({ t: 'maintenance.issues' }); workKey = ''; void refresh(); }, id => { saveDraft(); newConversation = false; selected = id; loadedDraft = ''; messages = []; messageKey = ''; selectTab('conversation'); void refresh(); }));
  }
  async function drawReview() {
    if (!state) return;
    const stack = state.stack ?? store.maintenance;
    const key = JSON.stringify([stack, state.worker?.status]);
    if (key === reviewKey) return;
    reviewKey = key;
    const changes = h('div.maintenance-review-commits');
    const working = h('div', {}, h('p', {}, 'Loading working edits…'));
    review.replaceChildren(h('div.maintenance-section-heading', {}, h('h3', {}, 'Review the repository'), h('button', { type: 'button', onclick: () => { reviewKey = ''; void drawReview(); } }, 'Refresh diff')),
      h('p', {}, `${stack.changes.length} stacked commits · ${stack.dirty} edited files · ${stack.branch ?? 'maintenance/stack'}`),
      h('button', { type: 'button', disabled: stack.validation?.phase === 'running' || stack.phase === 'shipping' || !!state.worker && !['idle', 'done', 'exited'].includes(state.worker.status), onclick: () => send({ t: 'maintenance.check' }) }, 'Run typecheck, tests & build'),
      ...(stack.validation ? [h('p.maintenance-review-status', {}, stack.validation.phase === 'running' ? `Checking: ${stack.validation.step ?? 'Starting'}…` : `${stack.validation.phase === 'passed' ? '✓' : '✕'} Checks ${stack.validation.phase} · ${new Date(stack.validation.finishedAt ?? stack.validation.at).toLocaleString()}${stack.validation.sha ? ` · HEAD ${stack.validation.sha}` : ''}`), ...(stack.validation.error ? [h('pre.maintenance-diff', {}, stack.validation.error)] : []), h('p.maintenance-muted', {}, 'Results describe this run. Further edits require another check; shipping checks the whole stack again.')] : []),
      h('p.maintenance-review-status', {}, stack.phase === 'shipping' ? `Checks / shipping: ${stack.step ?? 'Starting'}` : stack.phase === 'failed' ? `Checks / shipping failed: ${stack.error ?? 'Review the stack'}` : 'Agent check output appears in the live console. Shipping reruns typecheck, tests and build for the whole stack.'),
      h('button', { type: 'button', onclick: () => { modal.close(); reviewStack(); } }, 'Review stack & shipping controls'), changes,
      h('h4', {}, 'Uncommitted work'), h('p.maintenance-muted', {}, 'Includes tracked diffs and a list of new files. New-file contents are available to the agent in its worktree.'), working);
    for (const commit of [...stack.changes].reverse()) changes.append(h('button.maintenance-review-commit', { type: 'button', onclick: () => openStackChange(commit, reviewActions) }, h('code', {}, commit.sha), ` ${commit.subject}`, h('span', {}, 'Read diff / request correction →')));
    try {
      const result = await maintenanceJson<{ files: string; diff: string; truncated: boolean }>('/api/maintenance/working');
      if (closed || !working.isConnected) return;
      working.replaceChildren(h('pre.maintenance-working-files', {}, result.files || 'No uncommitted changes.'),
        ...(result.diff ? [h('details', {}, h('summary', {}, 'Tracked working diff'), h('pre.maintenance-diff', {}, result.diff))] : []),
        ...(result.truncated ? [h('p', {}, 'Large changes: this preview is truncated. Ask the agent to explain the rest.')] : []));
    } catch (err) { if (!closed && working.isConnected) working.replaceChildren(h('p.maintenance-chat-error', {}, (err as Error).message)); }
  }
  function updateControls() {
    const worker = state?.worker;
    model.repaint();
    const archived = !newConversation && !!selected && selected !== worker?.id;
    const waiting = worker?.status === 'needs_input';
    status.textContent = worker ? `${worker.status.replace(/_/g, ' ')}${state?.floorName ? ` · ${state.floorName}` : ''}` : 'Ready for your first request';
    terminal.disabled = end.disabled = !worker;
    const busy = !!worker && !['idle', 'done', 'exited'].includes(worker.status);
    create.disabled = !!pending;
    // Keep drafting available while busy or blocked; only dispatch is gated.
    input.disabled = !!pending || archived || !state || !!historyFailed;
    images.disable(input.disabled);
    // Stuck on a question it can't get past, it can still be moved onto another model.
    submit.disabled = input.disabled || images.uploading || (waiting && !model.edited()) || (newConversation && busy) || state?.stack?.phase === 'shipping' || state?.stack?.validation?.phase === 'running';
    note.textContent = newConversation ? (busy ? 'Wait for the current issue to finish before starting a new conversation.' : 'New issue · starts a fresh conversation and keeps the previous history.') : archived ? 'Archived conversation · choose Current conversation to send a new request.'
      : waiting ? 'Maintenance needs an answer or approval. Respond in the live console beside this conversation.'
      : state && !state.richReplies ? 'This provider uses the terminal for replies. Requests are still archived.'
      : worker?.status === 'working' ? 'Follow-ups wait in the agent’s input box · Shift+Enter for a new line'
      : 'Enter to send · Shift+Enter for a new line · shared office conversation';
    current.setAttribute('aria-pressed', String(!newConversation && !archived));
    activity.textContent = worker?.activity ?? (worker ? 'Waiting for the next agent event…' : 'No active session. Send a request or start a queued issue.');
    attention.classList.toggle('hidden', !waiting && worker?.status !== 'exited');
    if (waiting) {
      attention.replaceChildren(h('strong', {}, 'Your attention is needed'), h('p', {}, worker?.activity ?? 'A provider question or permission prompt is waiting.'),
        h('button', { type: 'button', onclick: () => { consoleDetails.open = true; consoleHost.scrollIntoView({ block: 'nearest' }); } }, 'Respond in live console'));
      consoleDetails.open = true;
    } else if (worker?.status === 'exited') attention.replaceChildren(h('strong', {}, `Agent exited${worker.exitCode !== undefined ? ` (code ${worker.exitCode})` : ''}`), h('p', {}, 'Review the console output. A new request resumes its saved session.'));
    if (worker?.id !== consoleWorker) {
      consoleView?.dispose(); consoleView = undefined; consoleWorker = worker?.id ?? '';
      if (worker) consoleView = maintenanceConsole(consoleHost, worker, send);
      else consoleHost.replaceChildren(h('p.maintenance-muted', {}, 'The live console appears when Maintenance starts.'));
    }
    if (worker) consoleView?.update(worker);
    drawWork();
    if (tab === 'review') void drawReview();
  }
  async function refresh(before?: string) {
    const ticket = ++generation;
    const previousSelected = selected;
    try {
      const params = new URLSearchParams();
      if (selected) params.set('thread', selected);
      if (before) params.set('before', before);
      let next = await maintenanceJson<MaintenanceChatState>(`/api/maintenance/chat?${params}`);
      if (closed || ticket !== generation || previousSelected !== selected) return;
      state = next;
      loadDraft();
      if (historyFailed) { showError(''); historyFailed = false; }
      if (newConversation) next = { ...next, conversation: undefined };
      const incoming = next.conversation?.messages ?? [];
      const sameThread = list.dataset.thread === next.conversation?.id;
      const byId = new Map<string, MaintenanceChatMessage>();
      if (sameThread) messages.forEach(m => byId.set(m.id, m));
      // Pending API requests are replaced by their transcript IDs; drop only that local copy.
      const pendingContents = new Set(incoming.filter(m => !m.pending && m.role === 'user').map(m => m.content));
      for (const [id, m] of byId) if (m.pending && pendingContents.has(m.content)) byId.delete(id);
      incoming.forEach(m => byId.set(m.id, m));
      messages = [...byId.values()].sort((a, b) => a.at - b.at);
      const key = JSON.stringify([next.conversation?.id, messages]);
      if (key !== messageKey) {
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        const height = list.scrollHeight;
        const top = list.scrollTop;
        messageKey = key;
        list.dataset.thread = next.conversation?.id ?? '';
        const expanded = new Map([...list.querySelectorAll<HTMLElement>('[data-message]')].map(el => [el.dataset.message, [...el.querySelectorAll('details')].map(d => d.open)]));
        list.replaceChildren(...messages.map(bubble), ...(!messages.length ? [h('div.maintenance-chat-empty', {}, h('h3', {}, 'What should we improve?'), h('p', {}, 'Ask for a feature, report a bug, or follow up on a stacked change. Maintenance works in its own worktree; you review and ship the stack when ready.'))] : []));
        for (const el of list.querySelectorAll<HTMLElement>('[data-message]')) {
          const open = expanded.get(el.dataset.message);
          if (open) [...el.querySelectorAll('details')].forEach((d, i) => { d.open = open[i] ?? d.open; });
        }
        if (before) list.scrollTop = top + list.scrollHeight - height;
        else if (atBottom || !sameThread) list.scrollTop = list.scrollHeight;
      }
      if (before || !sameThread || messages.length === incoming.length) older.classList.toggle('hidden', tab !== 'conversation' || !next.conversation?.hasOlder);
      const aKey = JSON.stringify([next.conversations, selected, next.worker?.id, newConversation]);
      if (archiveKey !== aKey) { archiveKey = aKey; drawArchive(); }
      updateControls();
    } catch (err) {
      if (!closed && ticket === generation) { historyFailed = true; showError(`Could not load history: ${(err as Error).message}`); status.textContent = 'Connection unavailable · retrying'; updateControls(); status.textContent = 'Connection unavailable · retrying'; }
    }
  }
  older.addEventListener('click', () => { if (messages.length) void refresh(messages[0].id); });
  function receive(message: Sent) {
    if (pending?.id !== message.id || closed) return;
    clearTimeout(pending.timer);
    const text = pending.text;
    const attachments = pending.attachments;
    pending = undefined;
    if (message.error) { issueStart = false; input.value = text; images.set(attachments); showError(message.error); updateControls(); input.focus(); }
    else { input.value = ''; images.set([]); if (loadedDraft && !issueStart) delete drafts[loadedDraft]; issueStart = false; loadedDraft = ''; initial = ''; saveDraft(); newConversation = false; selectTab('conversation'); selected = message.workerId; messageKey = ''; messages = []; void refresh().then(() => input.focus()); }
  }
  receipts.add(receive);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim() || (images.images.length ? 'Please inspect the attached screenshots.' : '');
    if (!text || submit.disabled || !model.valid()) return;
    showError('');
    const id = crypto.randomUUID();
    issueStart = false;
    saveDraft();
    pending = { id, text, attachments: [...images.images], timer: setTimeout(() => {
      pending = undefined;
      updateControls();
      showError('No acknowledgement yet. Check the terminal before sending again.');
    }, 30_000) };
    updateControls();
    send({ t: 'maintenance.chat.send', id, prompt: text, attachments: images.images.map(i => i.id), ...(model.edited() ? { provider: model.value(), model: model.model(), effort: model.effort() } : {}), ...(newConversation ? { newConversation: true } : { thread: selected ?? state?.worker?.id }) });
  });
  input.addEventListener('input', saveDraft);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  const offWorkers = store.on('workers', () => void refresh());
  const offIssues = store.on('maintenanceIssues', () => { workKey = ''; drawWork(); });
  const offStack = store.on('maintenance', () => { if (state) state.stack = store.maintenance; drawWork(); if (tab === 'review') void drawReview(); });
  send({ t: 'maintenance.issues' });
  send({ t: 'maintenance.stack' });
  selectTab('conversation');
  const poll = setInterval(() => { if (!document.hidden) void refresh(); }, 2500);
  updateControls();
  void refresh().then(() => { if (!closed && !input.disabled) input.focus(); });
  return Object.assign(modal, { review: () => selectTab('review') });
}
