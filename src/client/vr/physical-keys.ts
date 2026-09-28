/**
 * A physical (Bluetooth) keyboard while presenting: DOM key events become the same terminal
 * bytes the world-space keyboard sends, and no desktop keybind sees them.
 *
 * The boundary is one capture-phase listener on window. It runs before every other key
 * listener in the page (desktop keybinds, walking, DOM dialogs, text fields), and while the
 * session presents it stops each key event there. Typeable keys also lose their browser
 * default, so Space doesn't scroll and Tab doesn't move focus behind the headset. Meta
 * (⌘/Win) chords, function keys and bare modifiers keep their browser behavior but still
 * reach no desktop keybind.
 */

/** The parts of a KeyboardEvent the mapping reads (tests pass plain objects). */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
  /** AltGr is down: ctrl+alt is how some layouts type @, € or {, not a chord. */
  altGraph?: boolean;
}

/** Cursor keys: CSI final byte, rewritten as CSI 1;mod X when modified (xterm's form). */
const CURSOR: Record<string, string> = { ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D', Home: 'H', End: 'F' };
/** Editing keys: CSI n ~, rewritten as CSI n;mod ~ when modified. */
const TILDE: Record<string, string> = { Insert: '2', Delete: '3', PageUp: '5', PageDown: '6' };

/** xterm's modifier parameter: 1 + shift + 2·alt + 4·ctrl. */
function modParam(k: KeyLike): number {
  return 1 + (k.shiftKey ? 1 : 0) + (k.altKey ? 2 : 0) + (k.ctrlKey ? 4 : 0);
}

/** Ctrl+key as a C0 control code (Ctrl+C is ETX); null for keys with no control code. */
function ctrlByte(ch: string): string | null {
  if (/^[a-z]$/i.test(ch)) return String.fromCharCode(ch.toUpperCase().charCodeAt(0) - 64);
  if (ch === ' ' || ch === '@' || ch === '2') return '\0';
  if (ch === '[') return '\x1b';
  if (ch === '\\') return '\x1c';
  if (ch === ']') return '\x1d';
  if (ch === '^' || ch === '6') return '\x1e';
  if (ch === '_' || ch === '-') return '\x1f';
  if (ch === '?') return '\x7f';
  return null;
}

/**
 * The terminal bytes a key press types, or null when it types nothing: bare modifiers,
 * function keys, dead keys, IME composition, and ⌘/Meta chords (the browser's shortcuts).
 */
export function keyBytes(k: KeyLike): string | null {
  if (k.metaKey || k.isComposing) return null;
  const mod = modParam(k);
  const cursor = CURSOR[k.key];
  if (cursor) return mod > 1 ? `\x1b[1;${mod}${cursor}` : `\x1b[${cursor}`;
  const tilde = TILDE[k.key];
  if (tilde) return mod > 1 ? `\x1b[${tilde};${mod}~` : `\x1b[${tilde}~`;
  const meta = (s: string) => (k.altKey ? `\x1b${s}` : s);
  switch (k.key) {
    case 'Enter':
      return meta('\r');
    case 'Backspace':
      return meta(k.ctrlKey ? '\b' : '\x7f');
    case 'Escape':
      return '\x1b';
    case 'Tab':
      return k.shiftKey ? '\x1b[Z' : '\t';
  }
  // Anything longer than one character is a named key with no bytes (Shift, F5, Dead…).
  if ([...k.key].length !== 1) return null;
  if (k.altGraph || (k.ctrlKey && k.altKey && !/^[a-z]$/i.test(k.key))) return k.key;
  if (k.ctrlKey) {
    const c = ctrlByte(k.key);
    return c === null ? null : meta(c);
  }
  // Alt+ASCII is meta (ESC prefix, readline's word keys); a non-ASCII key with Alt down is
  // already the composed character (macOS Option+e and friends).
  if (k.altKey && k.key.charCodeAt(0) < 0x80) return `\x1b${k.key}`;
  return k.key;
}

function keyLike(e: KeyboardEvent): KeyLike {
  return {
    key: e.key,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    shiftKey: e.shiftKey,
    metaKey: e.metaKey,
    isComposing: e.isComposing,
    altGraph: typeof e.getModifierState === 'function' ? e.getModifierState('AltGraph') : false,
  };
}

export interface VrKeyCapture {
  /** True while the session presents: every key event stops at the capture listener. */
  active: () => boolean;
  /** A typed key's bytes, for the focused VR input (it may have none: then they drop). */
  onBytes: (bytes: string) => void;
}

/** Installs the presenting-time key boundary on window (or any EventTarget, for tests), for the page's life. */
export function captureVrKeys(target: EventTarget, opts: VrKeyCapture): void {
  const down = (ev: Event) => {
    if (!opts.active()) return;
    ev.stopImmediatePropagation();
    const bytes = keyBytes(keyLike(ev as KeyboardEvent));
    if (bytes === null) return;
    ev.preventDefault();
    opts.onBytes(bytes);
  };
  // Key-up listeners (emote wheel release, walking) would act on a press they never saw.
  const up = (ev: Event) => {
    if (opts.active()) ev.stopImmediatePropagation();
  };
  target.addEventListener('keydown', down, true);
  target.addEventListener('keyup', up, true);
}
