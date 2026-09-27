// Searching the chat and the terminals. The server finds the lines; the browser uses the same
// rules to find a hit again in its own copy of a terminal and scroll to it.

/** Queries shorter than this match too much to be useful. */
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 200;

/** Text as a search compares it: any case, and a run of whitespace (a TUI's padding) as one space. */
export function searchKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The part of a terminal buffer a search reads (the headless one on the server, xterm.js in the browser). */
export interface BufferLike {
  readonly length: number;
  getLine(y: number): { readonly isWrapped: boolean; translateToString(trimRight?: boolean): string } | undefined;
}

/** A buffer's lines as they were printed: rows the terminal wrapped are joined back into one line. */
export function logicalLines(buf: BufferLike): { row: number; text: string }[] {
  const out: { row: number; text: string }[] = [];
  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    const wrapsOn = buf.getLine(y + 1)?.isWrapped === true;
    // A row that wraps onto the next keeps its trailing spaces; they are part of the line.
    const text = line.translateToString(!wrapsOn);
    const last = out[out.length - 1];
    if (line.isWrapped && last) last.text += text;
    else out.push({ row: y, text });
  }
  return out;
}

/** The logical line in `buf` holding `needle` (a searchKey) whose distance from the bottom is closest to `fromEnd`. */
export function findLine(buf: BufferLike, needle: string, fromEnd: number): number | undefined {
  let best: number | undefined;
  let bestDist = Infinity;
  for (const { row, text } of logicalLines(buf)) {
    if (!searchKey(text).includes(needle)) continue;
    const dist = Math.abs(buf.length - row - fromEnd);
    if (dist < bestDist) {
      best = row;
      bestDist = dist;
    }
  }
  return best;
}

/** `text` with its whitespace collapsed, cut down to about `width` characters around the match. */
export function snippet(text: string, needle: string, width = 180): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= width) return flat;
  const at = flat.toLowerCase().indexOf(needle);
  const start = Math.max(0, Math.min(at - Math.floor((width - needle.length) / 3), flat.length - width));
  const end = start + width;
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}
