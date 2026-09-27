import type headless from '@xterm/headless';
import type serialize from '@xterm/addon-serialize';
import { SCROLLBACK } from './ptys.js';

/** The DECSET modes xterm.js reads as a mouse report encoding: SGR and SGR pixels. */
const MOUSE_ENCODINGS = [1006, 1016];

/**
 * A snapshot of `term` that a fresh terminal replays into the same screen, mouse included.
 *
 * The serialize addon puts mouse tracking back but not its encoding, so a browser attaching to
 * OpenCode (tracking plus SGR, 1006) sent the wheel in the default encoding, which the office
 * doesn't forward and OpenCode doesn't read: scrolling and clicking did nothing. So the encoding
 * is followed here, the way xterm.js sets and resets it, and appended to every snapshot.
 */
export function screenSnapshot(term: InstanceType<typeof headless.Terminal>, ser: InstanceType<typeof serialize.SerializeAddon>): () => string {
  let encoding: number | undefined;
  const decset = (on: boolean) => (params: (number | number[])[]) => {
    for (const p of params) {
      if (typeof p === 'number' && MOUSE_ENCODINGS.includes(p)) encoding = on ? p : undefined;
    }
    return false; // xterm.js still switches the mode itself
  };
  term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, decset(true));
  term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, decset(false));
  term.parser.registerEscHandler({ final: 'c' }, () => {
    encoding = undefined; // a full reset (RIS)
    return false;
  });
  return () => ser.serialize({ scrollback: SCROLLBACK }) + (encoding ? `\x1b[?${encoding}h` : '');
}
