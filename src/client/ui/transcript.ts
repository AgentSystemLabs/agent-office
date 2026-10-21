// A worker's conversation as a chat, beside its terminal (the 💬 Chat tab, see termtabs.ts): your
// prompts, what it said back and what it did, from its transcript (shared/protocol/transcript.ts),
// in a page that scrolls like any chat does. Prompts go in as from the terminal's prompt box, and a
// permission prompt is answered with the same keys the keypad sends.
import './transcript.css';
import type { Net } from '../net';
import { store } from '../state';
import { h, timeAgo } from './dom';
import { markdown } from './markdown';
import { dictateField } from './dictate';
import type { ChatItem, ServerMsg, WorkerInfo } from '../../shared/protocol';
import { isAsleep } from '../../shared/status';

/** Within this many pixels of the bottom counts as reading the latest, so new items keep the view there. */
const STUCK_PX = 48;

const TOOL_ICON: Record<string, string> = { Bash: '💻', Read: '📖', Edit: '✏️', MultiEdit: '✏️', Write: '✏️', NotebookEdit: '✏️', Grep: '🔍', Glob: '🔍', WebFetch: '🌐', WebSearch: '🌐', Agent: '🤖', Task: '🤖', AskUserQuestion: '❓', TodoWrite: '📝', Skill: '🧩' };

export interface TranscriptPaneOptions {
  /** Types keys into the worker's terminal (1 2 3 for a prompt, Esc to interrupt). */
  key(keys: string): void;
  /** Shows the terminal tab, for what only it can answer. */
  toTerminal(): void;
}

export interface TranscriptPane {
  el: HTMLElement;
  onMsg(msg: ServerMsg): void;
  refresh(w: WorkerInfo): void;
  /** The tab's showing: follow the chat. */
  show(): void;
  /** Hidden behind another tab: stop following. */
  hide(): void;
  dispose(): void;
}

/** A tool's name as a person would say it: an MCP tool is "Server · tool", not mcp__server__tool. */
function toolLabel(name: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  if (!m) return name;
  const server = m[1].replace(/^claude_ai_/, '').replace(/_/g, ' ');
  return `${server} · ${m[2]}`;
}

function firstLine(s: string): string {
  const line = s.split('\n')[0];
  return line.length > 90 ? `${line.slice(0, 90)}…` : line;
}

export function transcriptPane(net: Net, workerId: string, opts: TranscriptPaneOptions): TranscriptPane {
  const older = h('button.btn.chat-older.hidden', { type: 'button' }, 'Earlier…');
  const empty = h('p.chat-empty', {}, 'Loading the conversation…');
  const log = h('div.chat-log', { role: 'log', 'aria-live': 'polite' }, older, empty);
  const busy = h('div.chat-busy.hidden');
  const askText = h('span.chat-ask-text');
  const askKeys = h('div.chat-ask-keys');
  const toTerm = h('button.btn', { type: 'button', title: 'The terminal, where the choices show in full' }, '💻 Terminal');
  const ask = h('div.chat-ask.hidden', { role: 'status' }, askText, askKeys, toTerm);
  const say = h('input', { type: 'text', placeholder: 'Reply, or tell it what to do next…', 'aria-label': 'Prompt', enterkeyhint: 'send', autocomplete: 'off' }) as HTMLInputElement;
  const stop = h('button.btn', { type: 'button', title: 'Interrupt the worker (sends Esc)', 'aria-label': 'Interrupt' }, '⏹');
  const sendBtn = h('button.btn.primary', { type: 'submit' }, 'Send');
  const compose = h('form.chat-compose', {}, stop, dictateField(say), sendBtn);
  const el = h('div.chat-pane.hidden', {}, log, busy, ask, compose);

  const rows = new Map<string, HTMLElement>();
  let first: ChatItem | undefined;
  let more = false;
  let shown = false;
  let loading = false;

  const stuck = () => log.scrollHeight - log.scrollTop - log.clientHeight < STUCK_PX;
  const toBottom = () => (log.scrollTop = log.scrollHeight);

  /** The row for an item: a bubble, a tool call that opens up, or a note between them. */
  const render = (item: ChatItem): HTMLElement => {
    const when = { title: new Date(item.at).toLocaleString() };
    if (item.role === 'tool' && item.tool) {
      const t = item.tool;
      const mark = t.result === undefined ? h('span.chat-tool-mark.running', { title: 'Running' }, '⏳') : t.error ? h('span.chat-tool-mark.failed', { title: 'Failed' }, '✗') : h('span.chat-tool-mark.ok', { title: 'Done' }, '✓');
      const summary = h('summary', {}, h('span.chat-tool-icon', {}, TOOL_ICON[t.name] ?? '🔧'), h('span.chat-tool-name', { title: t.name }, toolLabel(t.name)), h('span.chat-tool-gist', {}, firstLine(t.input)), mark);
      const body = h('div.chat-tool-body', {}, h('pre', {}, t.input), t.result !== undefined ? h('pre.chat-tool-result', { class: t.error ? 'failed' : '' }, t.result || '(no output)') : null);
      return h('details.chat-tool', when, summary, body);
    }
    if (item.role === 'agent') return h('div.chat-msg.agent', when, markdown(item.text ?? ''));
    if (item.role === 'note') return h('div.chat-note', when, item.text ?? '');
    return h('div.chat-msg.you', when, item.text ?? '');
  };

  const add = (items: ChatItem[], where: 'end' | 'start') => {
    const frag = document.createDocumentFragment();
    for (const item of items) {
      const row = render(item);
      rows.set(item.id, row);
      frag.append(row);
    }
    if (where === 'end') log.append(frag);
    else older.after(frag);
  };

  const onMsg = (msg: ServerMsg) => {
    if (msg.t === 'transcript.none') {
      if (msg.workerId !== workerId) return;
      empty.textContent = msg.why;
      empty.classList.remove('hidden');
      return;
    }
    if (msg.t !== 'transcript.items' || msg.workerId !== workerId) return;
    const { items, mode } = msg;
    if (mode === 'reset') {
      for (const row of rows.values()) row.remove();
      rows.clear();
      more = !!msg.more;
      first = items[0];
      empty.classList.toggle('hidden', items.length > 0);
      if (!items.length) empty.textContent = 'Nothing said yet';
      add(items, 'end');
      older.classList.toggle('hidden', !more);
      requestAnimationFrame(toBottom);
    } else if (mode === 'append') {
      const follow = stuck();
      empty.classList.add('hidden');
      add(items, 'end');
      first ??= items[0];
      if (follow) requestAnimationFrame(toBottom);
    } else if (mode === 'prepend') {
      loading = false;
      older.toggleAttribute('disabled', false);
      const before = log.scrollHeight;
      add(items, 'start');
      if (items.length) first = items[0];
      more = !!msg.more;
      older.classList.toggle('hidden', !more);
      // Stay on the line you were reading: the new rows push it down by their height.
      log.scrollTop += log.scrollHeight - before;
    } else if (mode === 'patch') {
      const follow = stuck();
      for (const item of items) {
        const old = rows.get(item.id);
        if (!old) continue;
        const row = render(item);
        if (old instanceof HTMLDetailsElement && old.open) (row as HTMLDetailsElement).open = true;
        old.replaceWith(row);
        rows.set(item.id, row);
      }
      if (follow) requestAnimationFrame(toBottom);
    }
  };

  const refresh = (w: WorkerInfo) => {
    const asleep = isAsleep(w.status);
    sendBtn.toggleAttribute('disabled', asleep);
    stop.toggleAttribute('disabled', asleep);
    busy.classList.toggle('hidden', w.status !== 'working');
    if (w.status === 'working') busy.textContent = `✍️ ${w.activity || 'Working…'}`;
    const asking = w.status === 'needs_input' && !asleep;
    ask.classList.toggle('hidden', !asking);
    if (asking) {
      const permission = /^wants permission/i.test(w.activity ?? '');
      askText.textContent = w.activity || 'Waiting for your answer';
      const labels = permission ? ['1 · Yes', '2 · Always', '3 · No'] : ['1', '2', '3'];
      askKeys.replaceChildren(
        ...labels.map((label, i) =>
          h('button.btn', { type: 'button', title: `Answer ${i + 1}`, onclick: () => opts.key(String(i + 1)) }, label),
        ),
      );
      toTerm.classList.toggle('hidden', permission);
    }
    if (w.lastInput) say.title = `${w.lastInput.by} typed here last, ${timeAgo(w.lastInput.at)}`;
  };

  older.addEventListener('click', () => {
    if (loading || !first) return;
    loading = true;
    older.toggleAttribute('disabled', true);
    net.send({ t: 'transcript.more', workerId, before: first.id });
  });
  toTerm.addEventListener('click', () => opts.toTerminal());
  stop.addEventListener('click', () => {
    if (!stop.hasAttribute('disabled')) opts.key('\x1b');
  });
  compose.addEventListener('submit', (e) => {
    e.preventDefault();
    const prompt = say.value.trim();
    if (!prompt || sendBtn.hasAttribute('disabled')) return;
    net.send({ t: 'worker.prompt', workerId, prompt });
    say.value = '';
  });

  return {
    el,
    onMsg,
    refresh,
    show() {
      el.classList.remove('hidden');
      if (!shown) net.send({ t: 'transcript.attach', workerId });
      shown = true;
      const w = store.workers.get(workerId);
      if (w) refresh(w);
      requestAnimationFrame(toBottom);
    },
    hide() {
      el.classList.add('hidden');
      if (shown) net.send({ t: 'transcript.detach', workerId });
      shown = false;
    },
    dispose() {
      if (shown) net.send({ t: 'transcript.detach', workerId });
      shown = false;
    },
  };
}
