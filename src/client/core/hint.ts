/**
 * The pieces every hint bar is made of (the key to press, the name of what you're facing, what's
 * going on there), for the office's own hints and every feature's (see core/context.ts's Hint).
 */
import type { DeskKey } from '../interaction';
import { h } from '../ui/dom';
import type { Interactable } from '../world/types';
import type { Hint } from './context';

export function key(k: string, label: string) {
  return h('span', {}, h('span.key', {}, k), label);
}

/** Secondary text in the hint bar. */
export function aside(text: string) {
  return h('span', { style: 'opacity:.75;font-weight:600' }, text);
}

/** What the hint bar calls the thing you're facing. */
export function hintTitle(text: string) {
  return h('span.title', {}, text);
}

/** A board you open with E. */
export function boardHint(name: string): Hint {
  return { k: '', parts: [hintTitle(name), key('E', 'Open')] };
}

/** A use that's E only: every other key does nothing there. */
export function onE(fn: (it: Interactable) => void): (it: Interactable, key: DeskKey) => void {
  return (it, key) => {
    if (key === 'E') fn(it);
  };
}
