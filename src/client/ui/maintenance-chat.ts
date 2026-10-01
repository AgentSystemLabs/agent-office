import type { ClientMsg, MaintenanceChatMessage, MaintenanceChatState, ServerMsg } from '../../shared/protocol';
import { store } from '../state';
import { h, openModal } from './dom';
import { markdown } from './markdown';
import { maintenanceJson } from './maintenance-board';
import type { MaintenanceActions } from './maintenance';

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
      message.phase === 'commentary' ? h('span', {}, 'Progress') : null),
    h('div.maintenance-bubble', {}, user ? h('p.maintenance-user-text', {}, message.content) : maintenanceContent(message.content)));
}

/** A view over the existing Maintenance worker; archived conversations are read-only. */
export function openMaintenanceChat(send: (message: ClientMsg) => void, actions: MaintenanceActions, reviewStack: () => void, initial = '') {
  let closed = false;
  let selected: string | undefined;
  let state: MaintenanceChatState | undefined;
  let generation = 0;
  let messageKey = '';
  let archiveKey = '';
  let historyFailed = false;
  let messages: MaintenanceChatMessage[] = [];
  let pending: { id: string; text: string; timer: ReturnType<typeof setTimeout> } | undefined;
  const search = h('input', { type: 'search', placeholder: 'Search conversations', 'aria-label': 'Search Maintenance history' });
  const archive = h('div.maintenance-chat-archive');
  const list = h('div.maintenance-chat-messages', { role: 'log', 'aria-label': 'Maintenance conversation', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  const status = h('span.maintenance-chat-status', {}, 'Connecting…');
  const error = h('p.maintenance-chat-error.hidden', { role: 'alert' });
  const note = h('p.maintenance-composer-note');
  const input = h('textarea', { rows: 2, maxlength: 20000, placeholder: 'Ask Maintenance to build, fix, or explain something…', 'aria-label': 'Message to Maintenance' });
  input.value = initial;
  const submit = h('button.maintenance-send', { type: 'submit' }, 'Send');
  const older = h('button.maintenance-older.hidden', { type: 'button' }, 'Load earlier messages');
  const terminal = h('button', { type: 'button', onclick: () => {
    if (state?.worker && state.floor) { modal.close(); actions.watch(state.worker, state.floor); }
  } }, 'Open terminal');
  const current = h('button.maintenance-current', { type: 'button', onclick: () => { selected = undefined; messageKey = ''; messages = []; void refresh(); } }, 'Current conversation');
  const form = h('form.maintenance-chat-composer', {}, error, input,
    h('div.maintenance-composer-bottom', {}, note, submit));
  const close = h('button.close', { type: 'button', 'aria-label': 'Close Maintenance chat' }, '✕');
  const el = h('div.modal.maintenance-chat', { role: 'dialog', 'aria-label': 'Maintenance chat experiment' },
    h('header', {}, h('div', {}, h('span.maintenance-experiment', {}, 'EXPERIMENT'), h('h2', {}, 'Maintenance'), status),
      h('div.maintenance-chat-tools', {}, h('button', { type: 'button', onclick: () => { modal.close(); reviewStack(); } }, 'Review stack'), terminal, close)),
    h('div.maintenance-chat-layout', {},
      h('aside', {}, current, h('h3', {}, 'Conversation archive'), h('small', {}, 'Shared with the office · saved across restarts'), search, archive),
      h('section.maintenance-chat-main', {}, older, list, form)));
  const modal = openModal(el, { doing: 'chatting with Maintenance', onClose: () => {
    closed = true;
    generation++;
    clearInterval(poll);
    if (pending) clearTimeout(pending.timer);
    receipts.delete(receive);
    offWorkers();
  } });
  close.addEventListener('click', () => modal.close());

  function showError(text: string) { error.textContent = text; error.classList.toggle('hidden', !text); }
  function drawArchive() {
    if (!state) return;
    const q = search.value.trim().toLowerCase();
    const entries = state.conversations.filter(c => c.title.toLowerCase().includes(q));
    archive.replaceChildren(...entries.map(c => h('button.maintenance-conversation', {
      type: 'button', class: (selected ?? state?.worker?.id) === c.id ? 'selected' : '',
      'aria-pressed': String((selected ?? state?.worker?.id) === c.id),
      onclick: () => { selected = c.id; messages = []; messageKey = ''; void refresh(); },
    }, h('b', {}, c.title), h('small', {}, `${new Date(c.updatedAt).toLocaleDateString()} · ${c.count} messages`))),
    ...(!entries.length ? [h('p.maintenance-archive-empty', {}, q ? 'No matching conversations' : 'Conversations appear here after your first request.')] : []));
  }
  search.addEventListener('input', drawArchive);
  function updateControls() {
    const worker = state?.worker;
    const archived = !!selected && selected !== worker?.id;
    const waiting = worker?.status === 'needs_input';
    status.textContent = worker ? `${worker.status.replace(/_/g, ' ')}${state?.floorName ? ` · ${state.floorName}` : ''}` : 'Ready for your first request';
    terminal.disabled = !worker;
    input.disabled = !!pending || archived || waiting || !state;
    submit.disabled = input.disabled;
    note.textContent = archived ? 'Archived conversation · choose Current conversation to send a new request.'
      : waiting ? 'Maintenance needs an answer or approval. Open the terminal to respond.'
      : state && !state.richReplies ? 'This provider uses the terminal for replies. Requests are still archived.'
      : worker?.status === 'working' ? 'Follow-ups wait in the agent’s input box · Shift+Enter for a new line'
      : 'Enter to send · Shift+Enter for a new line · shared office conversation';
    current.setAttribute('aria-pressed', String(!archived));
  }
  async function refresh(before?: string) {
    const ticket = ++generation;
    const previousSelected = selected;
    try {
      const params = new URLSearchParams();
      if (selected) params.set('thread', selected);
      if (before) params.set('before', before);
      const next = await maintenanceJson<MaintenanceChatState>(`/api/maintenance/chat?${params}`);
      if (closed || ticket !== generation || previousSelected !== selected) return;
      state = next;
      if (historyFailed) { showError(''); historyFailed = false; }
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
      if (before || !sameThread || messages.length === incoming.length) older.classList.toggle('hidden', !next.conversation?.hasOlder);
      const aKey = JSON.stringify([next.conversations, selected, next.worker?.id]);
      if (archiveKey !== aKey) { archiveKey = aKey; drawArchive(); }
      updateControls();
    } catch (err) {
      if (!closed && ticket === generation) { historyFailed = true; showError(`Could not load history: ${(err as Error).message}`); status.textContent = 'Connection unavailable · retrying'; }
    }
  }
  older.addEventListener('click', () => { if (messages.length) void refresh(messages[0].id); });
  function receive(message: Sent) {
    if (pending?.id !== message.id || closed) return;
    clearTimeout(pending.timer);
    const text = pending.text;
    pending = undefined;
    if (message.error) { input.value = text; showError(message.error); updateControls(); input.focus(); }
    else { input.value = ''; selected = undefined; messageKey = ''; messages = []; void refresh().then(() => input.focus()); }
  }
  receipts.add(receive);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || submit.disabled) return;
    showError('');
    const id = crypto.randomUUID();
    pending = { id, text, timer: setTimeout(() => {
      pending = undefined;
      updateControls();
      showError('No acknowledgement yet. Check the terminal before sending again.');
    }, 30_000) };
    updateControls();
    send({ t: 'maintenance.chat.send', id, prompt: text });
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  const offWorkers = store.on('workers', () => void refresh());
  const poll = setInterval(() => { if (!document.hidden) void refresh(); }, 2500);
  updateControls();
  void refresh().then(() => { if (!closed && !input.disabled) input.focus(); });
  return modal;
}
