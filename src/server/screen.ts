import type headless from '@xterm/headless';
import type serialize from '@xterm/addon-serialize';
import { SCROLLBACK } from './ptys.js';

/** The DECSET modes xterm.js reads as a mouse report encoding: SGR and SGR pixels. */
const MOUSE_ENCODINGS = [1006, 1016];

/** The DECSET modes that swap in a program's full-screen buffer: the alternate screen, and 1049, which also saves the cursor. */
const ALT_SCREENS = [47, 1047, 1049];

/** Entering the full-screen buffer, which is what a worker's output is scanned for. */
const ENTER_FULL_SCREEN = /\x1b\[\?(?:1049|1047|47)h/;

/** Entering or leaving it, either way. */
const SWAP_FULL_SCREEN = /\x1b\[\?(?:1049|1047|47)[hl]/g;

/**
 * `data` a worker printed, with the full-screen buffer kept out of the office's copy of its terminal.
 *
 * Every agent but a shell draws full-screen, and xterm.js gives that buffer no scrollback: whatever
 * the agent scrolled past the top was gone for good. Searching a worker's terminal found only the
 * last screenful, and so did the scrollback saved across a restart. Dropping the mode keeps the
 * drawing on the one buffer, which scrolls the way a terminal's does, and the transcript is then
 * complete. What is on screen is unchanged either way, since a full-screen agent redraws every row.
 *
 * Where the mode was, the screen is scrolled clear instead: the agent asked for a blank one and not
 * all of them clear it themselves, and a real terminal leaves what was on it there to come back to.
 * Scrolling is how that happens on one buffer — erasing would throw those lines away — and it goes in
 * here, in the bytes, rather than in a parser handler: a write made from inside one is parsed after
 * the rest of the chunk, which would wipe the very frame the agent had just drawn.
 *
 * Only the office's own copy is fed this. Viewers get what the worker really printed, and their
 * terminal switches buffers as it should.
 */
export function withoutFullScreen(data: string, rows: number): string {
  const enter = ENTER_FULL_SCREEN.exec(data);
  if (!enter) return data;
  const blank = `\x1b[r\x1b[${rows};1H${'\n'.repeat(rows)}\x1b[H`; // a full-height scroll region, then a screenful of it
  return `${data.slice(0, enter.index)}${blank}${data.slice(enter.index).replace(SWAP_FULL_SCREEN, '')}`;
}

/**
 * A snapshot of `term` that a fresh terminal replays into the same screen, mouse included.
 *
 * The serialize addon puts mouse tracking back but not its encoding, so a browser attaching to
 * OpenCode (tracking plus SGR, 1006) sent the wheel in the default encoding, which the office
 * doesn't forward and OpenCode doesn't read: scrolling and clicking did nothing. So the encoding
 * is followed here, the way xterm.js sets and resets it, and appended to every snapshot.
 *
 * The full-screen modes are dropped here too, for the scrollback's sake, but only as a backstop for
 * the ones `withoutFullScreen` misses: a scrollback written before this, replayed as a prelude. Both
 * patches share one handler per mode, since xterm.js keeps one handler per sequence and a second
 * registration would quietly replace the first.
 */
export function screenSnapshot(term: InstanceType<typeof headless.Terminal>, ser: InstanceType<typeof serialize.SerializeAddon>, onFullScreen?: () => void): () => string {
  let encoding: number | undefined;
  const decset = (on: boolean) => (params: (number | number[])[]) => {
    let alt = false;
    for (const p of params) {
      if (typeof p !== 'number') continue;
      if (MOUSE_ENCODINGS.includes(p)) encoding = on ? p : undefined;
      if (ALT_SCREENS.includes(p)) alt = true;
    }
    if (alt && on) onFullScreen?.();
    return alt; // false lets xterm.js switch the mode itself, true keeps it out of the buffer with no scrollback
  };
  term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, decset(true));
  term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, decset(false));
  term.parser.registerEscHandler({ final: 'c' }, () => {
    encoding = undefined; // a full reset (RIS)
    return false;
  });
  return () => ser.serialize({ scrollback: SCROLLBACK }) + (encoding ? `\x1b[?${encoding}h` : '');
}
