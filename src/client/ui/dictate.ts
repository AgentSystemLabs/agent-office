// Dictation: a 🎤 on a prompt box and in a worker's terminal. Hold it (or Ctrl+Space) and talk, and
// what you said is typed in where the cursor is once you let go; a quick tap leaves it listening,
// hands free, until the next one. Nothing is sent for you: you read it over and press Enter yourself.
// The listening is the browser's own (see speech.ts), so where a browser has none there's no 🎤.

import './dictate.css';
import { h, onModalChange, toast } from './dom';
import { checkOnDevice, listen, PushToTalk, speechSupport, spliceSpoken, type Listening } from './speech';

export interface DictateTarget {
  /** Puts a phrase where the cursor is. */
  insert(text: string): void;
  /** Whether it can't take words right now (a worker that's asleep). */
  off?(): boolean;
}

export interface Dictation {
  /** The 🎤, or null where the browser can't listen. */
  button: HTMLButtonElement | null;
  /** The words as they're heard, to put over whatever is being dictated into. Hidden until it listens. */
  live: HTMLElement;
  /** Give it each keydown of what's being dictated into: true when it was Ctrl+Space, which it took. */
  key(e: KeyboardEvent): boolean;
  /** Stops listening, for good: what was being dictated into is gone. */
  drop(): void;
}

const TITLE = 'Dictate: hold to talk (or hold Ctrl+Space) and let go, and what you said is typed in. A quick click leaves it listening until you click again';

/** The one that's listening now: there's one microphone, so a second 🎤 cuts off the first. */
let active: { button: HTMLElement; abort(): void } | null = null;
const watchers = new Set<(on: boolean) => void>();

/** Hears when dictation starts and stops listening (voice chat mutes you meanwhile, see features/dictation). */
export function onDictating(fn: (on: boolean) => void) {
  watchers.add(fn);
}

// A window that closes takes its 🎤 with it.
onModalChange(() => {
  if (active && !active.button.isConnected) active.abort();
});

/** The end of what's being heard, which is the part that's changing. */
function tail(text: string, max = 90): string {
  return text.length > max ? `…${text.slice(text.length - max)}` : text;
}

export function dictation(target: DictateTarget, opts: { label?: string } = {}): Dictation {
  const live = h('div.dictate-live.hidden', { role: 'status' });
  if (speechSupport() === 'none') return { button: null, live, key: () => false, drop() {} };
  checkOnDevice();

  const button = h('button.btn.dictate-mic', { type: 'button', title: TITLE, 'aria-label': 'Dictate', 'aria-pressed': 'false' }, opts.label ? `🎤 ${opts.label}` : '🎤');
  let listening: Listening | null = null;
  const paint = (interim = '') => {
    const on = !!listening;
    button.classList.toggle('live', on);
    button.setAttribute('aria-pressed', String(on));
    live.classList.toggle('hidden', !on);
    live.textContent = !on ? '' : interim ? `🎙️ ${tail(interim)}` : '🎙️ Listening…';
  };

  const start = () => {
    if (listening || target.off?.()) return;
    if (speechSupport() === 'insecure') {
      toast('Dictation needs HTTPS (or localhost), like voice. Ask whoever runs the office to enable TLS.', 'warn');
      return;
    }
    active?.abort();
    let over = false;
    const mine = listen({
      interim: (text) => paint(text),
      said: (text) => target.insert(text),
      end: (problem) => {
        over = true;
        if (listening && listening === mine) {
          listening = null;
          active = null;
          watchers.forEach((fn) => fn(false));
        }
        paint();
        if (problem) toast(problem, 'warn');
      },
    });
    // It couldn't even start.
    if (over) return;
    listening = mine;
    active = { button, abort: () => mine.abort() };
    paint();
    watchers.forEach((fn) => fn(true));
  };
  const talk = new PushToTalk({ live: () => !!listening, start, stop: () => listening?.stop() });

  // The button: held down it's push to talk, and it never takes the focus from what you're typing in.
  const ups = ['pointerup', 'pointercancel'] as const;
  const lift = () => {
    for (const up of ups) window.removeEventListener(up, lift, true);
    talk.release();
  };
  button.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Let go anywhere, off the button or off the window, and it still hears of it.
    for (const up of ups) window.addEventListener(up, lift, true);
    try {
      button.setPointerCapture(e.pointerId);
    } catch {
      // that pointer is gone already
    }
    talk.press();
  });
  button.addEventListener('lostpointercapture', lift);
  button.addEventListener('mousedown', (e) => e.preventDefault());
  button.addEventListener('contextmenu', (e) => e.preventDefault());
  // Pressed from the keyboard (Enter or Space on it), there's no letting go to wait for: it turns on, or off.
  button.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    if (listening) listening.stop();
    else start();
  });

  // Ctrl+Space: held down it's push to talk too. Letting go of either key ends it, wherever that happens.
  const letGo = () => {
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', letGo);
    talk.release();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.key === 'Control') letGo();
  };

  return {
    button,
    live,
    key(e) {
      if (e.type !== 'keydown' || e.code !== 'Space' || !e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
      e.preventDefault();
      e.stopPropagation();
      // The key repeats while it's held.
      if (e.repeat || talk.down) return true;
      talk.press();
      window.addEventListener('keyup', onKeyUp, true);
      window.addEventListener('blur', letGo);
      return true;
    },
    drop() {
      letGo();
      lift();
      listening?.abort();
    },
  };
}

/**
 * A text box you can dictate into: the box with a 🎤 in its corner, to put where the box would go.
 * What you say goes in where its cursor is. Where the browser can't listen, it's the box as it was.
 */
export function dictateField(field: HTMLTextAreaElement | HTMLInputElement): HTMLElement {
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
  if (!d.button) return field;
  field.addEventListener('keydown', (e) => void d.key(e as KeyboardEvent));
  return h('div.dictate-field', { class: field instanceof HTMLInputElement ? 'line' : '' }, field, d.button, d.live);
}
