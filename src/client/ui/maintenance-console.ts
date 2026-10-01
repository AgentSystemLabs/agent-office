import '@xterm/xterm/css/xterm.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { ClientMsg, ServerMsg, WorkerInfo } from '../../shared/protocol';
import { h } from './dom';
import { TERM_THEME } from './termtheme';
import { subscribeTerminal } from './terminal';

/** Real provider UI, embedded beside work. No guessed permission buttons or parsed ANSI prompts. */
export function maintenanceConsole(host: HTMLElement, worker: WorkerInfo, send: (message: ClientMsg) => void) {
  const pane = h('div.maintenance-console-host', { 'aria-label': 'Live Maintenance console' });
  const keys = h('div.maintenance-console-keys');
  const term = new Terminal({ theme: TERM_THEME, fontSize: 12, scrollback: 1500, cursorBlink: true, allowProposedApi: true });
  const fit = new FitAddon();
  term.loadAddon(fit); term.loadAddon(new WebLinksAddon());
  let info = worker;
  let lastSentSize = '';
  let ready = false;
  let disposed = false;
  const write = (data: string) => { if (ready && info.status !== 'exited') { try { fit.fit(); } catch { /* Keep the current dimensions. */ } lastSentSize = `${term.cols}x${term.rows}`; send({ t: 'term.resize', workerId: worker.id, cols: term.cols, rows: term.rows }); send({ t: 'term.input', workerId: worker.id, data }); } };
  for (const [label, data] of [['↑', 'up'], ['↓', 'down'], ['Enter', '\r'], ['Tab', '\t'], ['Send Esc', '\x1b'], ['Ctrl+C', '\x03']]) {
    keys.append(h('button', { type: 'button', onclick: () => write(data === 'up' ? term.modes.applicationCursorKeysMode ? '\x1bOA' : '\x1b[A' : data === 'down' ? term.modes.applicationCursorKeysMode ? '\x1bOB' : '\x1b[B' : data) }, label));
  }
  // This writes to the active provider prompt, including menus and questions; never appends a new task brief.
  const answer = h('input', { type: 'text', placeholder: 'Answer the prompt shown above…', 'aria-label': 'Console answer', maxlength: 4000 });
  const submit = h('button', { type: 'submit' }, 'Answer');
  const form = h('form.maintenance-console-answer', {}, answer, submit);
  form.addEventListener('submit', e => { e.preventDefault(); if (!ready || !answer.value.trim()) return; write(`\x1b[200~${answer.value}\x1b[201~`); answer.value = ''; setTimeout(() => { if (!disposed) write('\r'); }, 120); });
  const receive = (msg: ServerMsg) => {
    if (msg.t === 'term.snapshot' && msg.workerId === worker.id) {
      term.reset(); term.resize(msg.cols, msg.rows);
      term.write(msg.data, () => { if (disposed) return; ready = true; term.scrollToBottom(); setEnabled(); });
    } else if (msg.t === 'term.data' && msg.workerId === worker.id) term.write(msg.data);
  };
  const setEnabled = () => { for (const button of keys.querySelectorAll('button')) button.disabled = !ready || info.status === 'exited'; answer.disabled = submit.disabled = !ready || info.status === 'exited'; };
  const off = subscribeTerminal(receive);
  host.replaceChildren(pane, keys, form);
  term.open(pane); setEnabled();
  term.attachCustomKeyEventHandler(e => e.key !== 'Escape');
  term.onData(write);
  const ro = new ResizeObserver(() => {
    if (disposed || !pane.clientWidth || !pane.clientHeight) return;
    // Spectators retain the actual PTY geometry; only the first viewer fits it on open.
    if (info.viewers.length > 1) return;
    try { fit.fit(); if (ready) { lastSentSize = `${term.cols}x${term.rows}`; send({ t: 'term.resize', workerId: worker.id, cols: term.cols, rows: term.rows }); } } catch { /* Container is still settling. */ }
  });
  ro.observe(pane);
  send({ t: 'worker.attach', workerId: worker.id });
  return { update(next: WorkerInfo) { info = next; setEnabled(); const size = `${next.cols}x${next.rows}`; if (ready && next.cols > 0 && next.rows > 0 && size !== lastSentSize && size !== `${term.cols}x${term.rows}`) term.resize(next.cols, next.rows); }, dispose() { disposed = true; off(); ro.disconnect(); send({ t: 'worker.detach', workerId: worker.id }); term.dispose(); host.replaceChildren(); } };
}
