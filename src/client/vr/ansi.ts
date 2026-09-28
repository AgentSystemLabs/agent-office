/**
 * Pure ANSI color and scrollback helpers for the VR terminal panel.
 *
 * The palette follows the laptop screens' approach (see world/laptop.ts): the 16 base colors
 * come from TERM_THEME so both paint the same hues, then the 216-color cube and the 24-step
 * grey ramp extend them to the full 256. The theme arrives as a parameter so this file stays
 * free of THREE imports and host-testable. Server screen frames already decode SGR into Runs
 * (see shared/protocol.ts); this file only maps those runs to CSS colors.
 */

import { RGB_FLAG, type Run } from '../../shared/protocol';

/** The 16 ANSI base colors, in TERM_THEME's shape. */
export interface AnsiTheme {
  background: string;
  foreground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export function base16(theme: AnsiTheme): string[] {
  return [
    theme.black,
    theme.red,
    theme.green,
    theme.yellow,
    theme.blue,
    theme.magenta,
    theme.cyan,
    theme.white,
    theme.brightBlack,
    theme.brightRed,
    theme.brightGreen,
    theme.brightYellow,
    theme.brightBlue,
    theme.brightMagenta,
    theme.brightCyan,
    theme.brightWhite,
  ];
}

/** The full 256-color palette for a theme (memoize it at the call site; it rebuilds every call). */
export function fullPalette(theme: AnsiTheme): string[] {
  const p = base16(theme);
  const steps = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) p.push(`rgb(${steps[r]},${steps[g]},${steps[b]})`);
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    p.push(`rgb(${v},${v},${v})`);
  }
  return p;
}

/** A run's color code to a CSS color: -1 is the default, 0..255 index the palette, RGB_FLAG carries true color. */
export function runColor(code: number, fallback: string, palette: readonly string[]): string {
  if (code < 0) return fallback;
  if (code >= RGB_FLAG) {
    const rgb = code & 0xffffff;
    return `rgb(${(rgb >> 16) & 255},${(rgb >> 8) & 255},${rgb & 255})`;
  }
  return palette[code] ?? fallback;
}

/** Whether two runs paint the same text in the same colors (for scrollback detection). */
export function runsEqual(a: Run[] | undefined, b: Run[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((r, i) => r[0] === b[i][0] && r[1] === b[i][1] && r[2] === b[i][2] && r[3] === b[i][3]);
}

/**
 * Lines that scrolled off the top between two screen frames. When the new frame's first row
 * matches some old row k > 0, the terminal scrolled by k and old rows [0, k) are history now.
 * Anything else (a redraw, a resize, an alt-screen app) yields no history.
 */
export function scrolledOffLines(prev: Run[][], next: Run[][]): Run[][] {
  if (!prev.length || !next.length) return [];
  for (let k = 1; k < prev.length; k++) {
    if (runsEqual(prev[k], next[0])) return prev.slice(0, k).map((runs) => runs.map((r): Run => [r[0], r[1], r[2], r[3]]));
  }
  return [];
}

/** Pushes history lines, capped (oldest fall off). Returns the same array for chaining. */
export function pushHistory(history: Run[][], lines: Run[][], cap: number): Run[][] {
  for (const line of lines) {
    history.push(line);
    while (history.length > cap) history.shift();
  }
  return history;
}
