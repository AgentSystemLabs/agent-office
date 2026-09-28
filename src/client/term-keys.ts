/**
 * Modified Enter for worker terminals.
 *
 * xterm.js (6.0) encodes Enter as a bare CR whatever the modifiers (Alt adds an ESC prefix) and
 * speaks neither the kitty keyboard protocol nor xterm's modifyOtherKeys, so Ctrl+Enter and
 * Shift+Enter reach the PTY as plain Enter. Native terminals send them as CSI u sequences.
 *
 * Droid binds Ctrl+Enter (queue a message while it works) and Shift+Enter (newline) to exactly
 * those sequences, and parses them even when it has not negotiated the kitty protocol, so its
 * workers get them. Everything else keeps xterm.js's default bytes: a plain shell or another
 * agent that never asked for CSI u would print them as garbage.
 */

import type { AgentProvider, WorkerInfo } from '../shared/protocol';

export const CTRL_ENTER = '\x1b[13;5u';
export const SHIFT_ENTER = '\x1b[13;2u';

export interface KeyMods {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

/** Whether a worker's program understands CSI u Enter (resolve the provider first: old workers have none). */
export function wantsCsiEnter(kind: WorkerInfo['kind'] | undefined, provider: AgentProvider | undefined): boolean {
  return kind === 'agent' && provider === 'droid';
}

/** The bytes Enter with these modifiers should send, or undefined for the terminal's default. */
export function modifiedEnter(csiEnter: boolean, mods: KeyMods): string | undefined {
  if (!csiEnter || mods.alt || mods.meta) return undefined;
  if (mods.ctrl && !mods.shift) return CTRL_ENTER;
  if (mods.shift && !mods.ctrl) return SHIFT_ENTER;
  return undefined;
}

/** The slice of a KeyboardEvent the terminal's key handler reads. */
export interface KeyEventLike {
  type: string;
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

/**
 * What xterm.js's custom key handler should do with a key event: `send` the replacement bytes
 * (on keydown), `swallow` it (the keypress/keyup of a replaced Enter, so xterm doesn't add its
 * own CR), or `default` to let xterm handle it.
 */
export function enterKeyAction(csiEnter: boolean, e: KeyEventLike): { do: 'send'; data: string } | { do: 'swallow' } | { do: 'default' } {
  // Enter while an IME is composing commits the composition; it isn't a keystroke for the PTY.
  if (e.key !== 'Enter' || e.isComposing) return { do: 'default' };
  const data = modifiedEnter(csiEnter, { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
  if (data === undefined) return { do: 'default' };
  return e.type === 'keydown' ? { do: 'send', data } : { do: 'swallow' };
}
