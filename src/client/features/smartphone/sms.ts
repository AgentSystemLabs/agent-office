// The smartphone's SMS thread: what you sent, the worker's status as an honest hint, and a composer.
// The thread never redraws under you (the input keeps focus); store changes follow along live, and a
// sent text is appended by hand. The mic is created once per thread view and dropped on the way out.
import { appendSms, logRecent, MAX_SMS_TEXT, pruneThreadKeys, saveThread, threadKey } from '../../../shared/smartphone';
import { isAsleep } from '../../../shared/status';
import { store } from '../../state';
import { h, toast } from '../../ui/dom';
import { dictation } from '../../ui/dictate';
import { spliceSpoken } from '../../ui/speech';
import { dotColor, statusNote } from './logic';
import type { Phone } from './ui';

/** The thread's live bits, for following the worker without a redraw. */
export interface ThreadLive {
  id: string;
  who: HTMLElement;
  hint: HTMLElement;
  input: HTMLInputElement;
  send: HTMLElement;
  msgs: HTMLElement;
  dropMic(): void;
}

/** A text box you can dictate into, with its mic disposable (ui/dictate's field keeps its mic with the window instead). */
function dictateInput(field: HTMLInputElement): { el: HTMLElement; drop(): void } {
  const d = dictation({
    off: () => field.disabled,
    insert: (text) => {
      const start = field.selectionStart ?? field.value.length;
      const r = spliceSpoken(field.value, start, field.selectionEnd ?? start, text);
      field.value = r.value;
      field.setSelectionRange(r.caret, r.caret);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    },
  });
  if (!d.button) return { el: field, drop: d.drop };
  field.addEventListener('keydown', (e) => void d.key(e as KeyboardEvent));
  return { el: h('div.dictate-field.line', {}, field, d.button, d.live), drop: d.drop };
}

export function renderThread(phone: Phone, id: string): HTMLElement[] {
  const w = phone.worker(id);
  if (!w) {
    phone.go({ t: 'contacts' });
    return [];
  }
  if (w.lost) {
    // Like prompting at the desk: a lost worker gets fixed, not texted.
    const fix = () => {
      const now = phone.worker(id) ?? w;
      if (!now.worktree) {
        toast(`${now.name}'s workspace is gone and there is nothing to rebuild — send it home from its desk`, 'warn');
        return;
      }
      phone.close();
      phone.deps.fixLostWorktree(now);
    };
    return [
      h('div.sp-who', {}, h('span.sp-dot', { style: `background:${dotColor(w)}` }), h('div.sp-main', {}, h('div.sp-name', {}, `💬 ${w.name}`))),
      h('p.sp-empty', {}, '🌿 Its worktree is gone — put it back before texting.'),
      h('div.sp-actions', {}, h('button.btn.primary', { type: 'button', onclick: fix }, '🌿 Fix it')),
    ];
  }
  const key = threadKey(store.floor, id);
  let thread = store.smartphone.threads[key] ?? [];
  const asleep = isAsleep(w.status);
  const who = h('div.sp-name', {}, `💬 ${w.name}`);
  const hint = h('div.sp-hint', {}, statusNote(w));
  const input = h('input', { type: 'text', maxlength: MAX_SMS_TEXT, placeholder: asleep ? `${w.name} is asleep — call to wake it` : `Text ${w.name}…`, 'aria-label': 'Message', autocomplete: 'off' }) as HTMLInputElement;
  input.toggleAttribute('disabled', asleep);
  const sendBtn = h('button.btn.primary', { type: 'submit' }, 'Send');
  sendBtn.toggleAttribute('disabled', asleep);
  const mic = dictateInput(input);
  const form = h('form.sp-compose', {}, mic.el, sendBtn);
  const msgs = h('div.sp-thread', {});
  // Long threads render a window, not all 50 capped messages at full length: the last
  // WINDOW_MSGS with a "show earlier" expander, so opening scrolls without jank.
  const WINDOW_MSGS = 20;
  let showAll = false;
  const paintMsgs = () => {
    msgs.replaceChildren();
    const hidden = showAll ? 0 : Math.max(0, thread.length - WINDOW_MSGS);
    if (hidden) {
      const more = h('button.btn.sp-more', { type: 'button' }, `Show earlier (${hidden})`);
      more.addEventListener('click', () => {
        showAll = true;
        paintMsgs();
      });
      msgs.append(more);
    }
    for (const m of thread.slice(thread.length - (showAll ? thread.length : WINDOW_MSGS))) {
      msgs.append(m.dir === 'out' ? h('div.sp-bubble sp-out', {}, m.text) : h('div.sp-bubble sp-note', {}, m.text));
    }
    msgs.scrollTop = msgs.scrollHeight;
  };
  paintMsgs();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const now = phone.worker(id);
    if (!now) {
      phone.go({ t: 'contacts' });
      return;
    }
    if (now.lost) {
      if (!now.worktree) {
        toast(`${now.name}'s workspace is gone and there is nothing to rebuild — send it home from its desk`, 'warn');
        return;
      }
      phone.close();
      phone.deps.fixLostWorktree(now);
      return;
    }
    if (isAsleep(now.status)) {
      toast(`${now.name} is asleep — wake it (R at its desk, or call) before texting`, 'warn');
      return;
    }
    phone.deps.net.send({ t: 'worker.prompt', workerId: now.id, prompt: text });
    const st = store.smartphone;
    st.threads[key] = appendSms(st.threads[key], text);
    st.threads = pruneThreadKeys(st.threads);
    saveThread(key, st.threads[key] ?? []);
    thread = st.threads[key] ?? [];
    st.recents = logRecent(st.recents, { kind: 'sms', workerId: now.id, name: now.name, at: Date.now() });
    store.emit('smartphone');
    phone.deps.sound.smsSwoosh();
    toast(`📩 SMS sent to ${now.name}`);
    // By hand, not a redraw: the composer (and its mic) stay put, and the tab counts follow.
    msgs.append(h('div.sp-bubble sp-out', {}, text));
    msgs.scrollTop = msgs.scrollHeight;
    input.value = '';
    input.focus();
    phone.refreshTabs();
  });
  phone.setLive({ id, who, hint, input, send: sendBtn, msgs, dropMic: mic.drop });
  // Keep the focus timer tracked, so it can't fire after close or a view change.
  phone.after(30, () => input.focus());
  return [h('div.sp-who', {}, h('span.sp-dot', { style: `background:${dotColor(w)}` }), h('div.sp-main', {}, who)), msgs, hint, form];
}

/** Follows the worker without a redraw; a worker turning lost switches to the Fix it UI. */
export function liveThread(phone: Phone, live: ThreadLive | null) {
  if (!live) return phone.draw();
  const w = phone.worker(live.id);
  if (!w || w.lost) return phone.draw();
  live.who.replaceChildren(`💬 ${w.name}`);
  live.hint.replaceChildren(statusNote(w));
  const asleep = isAsleep(w.status);
  live.input.toggleAttribute('disabled', asleep);
  live.input.placeholder = asleep ? `${w.name} is asleep — call to wake it` : `Text ${w.name}…`;
  live.send.toggleAttribute('disabled', asleep);
}
