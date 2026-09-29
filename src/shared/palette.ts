// The command palette's matching (Ctrl+K, ⌘K on a Mac): which of the office's workers, issues, pull
// requests, boards, teammates and actions a few typed letters mean, best first. Pure, so the ranking
// is tested without a page (see ui/palette.ts for the window).

/** Something the palette can find: shown as `title` over `detail`; `keywords` are found but not shown. */
export interface PaletteItem {
  title: string;
  detail?: string;
  keywords?: (string | undefined)[];
}

/** How well some text matches a query: higher is better; `hits` are the matched characters' indices in it. */
export interface TextMatch {
  score: number;
  hits: number[];
}

export interface PaletteMatch<T extends PaletteItem> {
  item: T;
  score: number;
  /** Which text matched: the title, the detail, or one of the keywords. */
  field: 'title' | 'detail' | 'keyword';
  /** The matched characters' indices in that text. */
  hits: number[];
}

/** The most the palette lists at once: past that, typing more narrows it down. */
export const PALETTE_MAX = 50;

/** What each kind of match is worth: the whole text, its start, the start of a word, anywhere in it, a scattered subsequence. */
const EXACT = 1000;
const PREFIX = 900;
const WORD_START = 800;
const INSIDE = 600;
const WORDS = 500;
const SCATTERED = 300;
/** A title counts for most; a match in the detail line or a hidden keyword a little less. */
const WEIGHT = { title: 1, detail: 0.9, keyword: 0.85 } as const;

/** Lowercased one UTF-16 unit at a time, so indices still line up with the original text. */
function fold(text: string): string {
  let out = '';
  for (const c of text) {
    const l = c.toLowerCase();
    out += l.length === c.length ? l : c;
  }
  return out;
}

/** Whether index `i` of `text` starts a word: the first character, or one after a space or punctuation. */
function wordStart(text: string, i: number): boolean {
  return i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1]);
}

const range = (from: number, n: number) => Array.from({ length: n }, (_, k) => from + k);

/** Where `word` is in `text` (both folded), preferring the start of a word, or -1. */
function findWord(text: string, word: string, from = 0): number {
  let first = -1;
  for (let at = text.indexOf(word, from); at >= 0; at = text.indexOf(word, at + 1)) {
    if (wordStart(text, at)) return at;
    if (first < 0) first = at;
  }
  return first;
}

/**
 * How well `query` matches `text`, or null when it doesn't: the whole text beats its start, which
 * beats the start of a word inside it, which beats the letters anywhere in it, then every typed
 * word somewhere in it, and last the letters in order but scattered (fewer, closer gaps and
 * letters at word starts score higher). A shorter text wins a tie. An empty query matches all.
 */
export function matchText(query: string, text: string): TextMatch | null {
  const q = fold(query.replace(/\s+/g, ' ').trim());
  if (!q) return { score: 0, hits: [] };
  const t = fold(text);
  // A little for being short: "Login" over "Login page" when both start with it.
  const short = 50 / (10 + t.length);
  const whole = t.trim() === q;
  if (whole) return { score: EXACT + short, hits: range(t.indexOf(q), q.length) };
  const at = findWord(t, q);
  if (at >= 0) return { score: (at === 0 ? PREFIX : wordStart(t, at) ? WORD_START : INSIDE) + short, hits: range(at, q.length) };

  // Several words ("login fix"): each one somewhere, in any order.
  const words = q.split(' ');
  if (words.length > 1) {
    const hits: number[] = [];
    let starts = 0;
    for (const w of words) {
      const i = findWord(t, w);
      if (i < 0) {
        hits.length = 0;
        break;
      }
      if (wordStart(t, i)) starts++;
      hits.push(...range(i, w.length));
    }
    if (hits.length) return { score: WORDS + (50 * starts) / words.length + short, hits: [...new Set(hits)].sort((a, b) => a - b) };
  }

  // The letters in order, anywhere: each one where it starts a word if it can, else the next one along.
  const letters = q.replace(/ /g, '');
  const hits: number[] = [];
  let from = 0;
  for (const c of letters) {
    let i = t.indexOf(c, from);
    if (i < 0) return null;
    // A later word starting with it beats this one, unless it carries straight on from the last letter.
    if (!wordStart(t, i) && hits[hits.length - 1] !== i - 1) {
      for (let j = t.indexOf(c, i + 1); j >= 0; j = t.indexOf(c, j + 1)) {
        if (wordStart(t, j)) {
          // Only if the rest still fits after it.
          if (subsequenceFrom(t, letters.slice(hits.length + 1), j + 1)) i = j;
          break;
        }
      }
    }
    hits.push(i);
    from = i + 1;
  }
  let score = SCATTERED;
  for (let k = 0; k < hits.length; k++) {
    if (wordStart(t, hits[k])) score += 12;
    if (k > 0) score -= hits[k] - hits[k - 1] === 1 ? -6 : Math.min(8, hits[k] - hits[k - 1] - 1);
  }
  // Never as good as the letters together.
  return { score: Math.max(1, Math.min(INSIDE - 1, score - hits[0] * 0.5 + short)), hits };
}

function subsequenceFrom(t: string, letters: string, from: number): boolean {
  for (const c of letters) {
    const i = t.indexOf(c, from);
    if (i < 0) return false;
    from = i + 1;
  }
  return true;
}

/** How well `query` matches an item: its best text, weighted, or null when none of them match. */
export function matchItem<T extends PaletteItem>(query: string, item: T): PaletteMatch<T> | null {
  let best: PaletteMatch<T> | null = null;
  const consider = (text: string | undefined, field: PaletteMatch<T>['field']) => {
    if (!text) return;
    const m = matchText(query, text);
    if (!m) return;
    const score = m.score * WEIGHT[field];
    if (!best || score > best.score) best = { item, score, field, hits: m.hits };
  };
  consider(item.title, 'title');
  consider(item.detail, 'detail');
  for (const k of item.keywords ?? []) consider(k, 'keyword');
  return best;
}

/** The items `query` matches, best first (ties keep the order they came in), at most `limit` of them. */
export function rankItems<T extends PaletteItem>(query: string, items: readonly T[], limit = PALETTE_MAX): PaletteMatch<T>[] {
  const found: { m: PaletteMatch<T>; i: number }[] = [];
  items.forEach((item, i) => {
    const m = matchItem(query, item);
    if (m) found.push({ m, i });
  });
  found.sort((a, b) => b.m.score - a.m.score || a.i - b.i);
  return found.slice(0, limit).map((f) => f.m);
}

/** The parts of a keydown the palette's shortcut depends on. */
export type PaletteKey = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>;

/**
 * Whether a key press is the palette's shortcut: ⌘K on a Mac, Ctrl+K elsewhere, with no other
 * modifier. By the key's place too, for keyboards where K is another letter (Cyrillic, Greek).
 */
export function isPaletteKey(e: PaletteKey, mac: boolean): boolean {
  if (e.altKey || e.shiftKey || (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey)) return false;
  return e.key.toLowerCase() === 'k' || (e.code === 'KeyK' && !/^[ -~]$/.test(e.key));
}
