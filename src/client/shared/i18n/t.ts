// Look up a piece of UI copy in the language chosen in Settings. Keys are the source English text, so
// call sites stay readable; anything missing falls back to the source text. `t` has no DOM dependency,
// which lets the Node tests import it too.

import { es } from './catalogs';
import { patterns } from './patterns';
import { currentLanguage } from './language';

export type Params = Record<string, string | number>;

function fill(text: string, params?: Params): string {
  if (!params) return text;
  let out = text;
  for (const [key, value] of Object.entries(params)) out = out.replaceAll(`{${key}}`, String(value));
  return out;
}

/** Translate one string. Patterns catch the rendered form of sentences built with interpolated values. */
export function t(source: string, params?: Params): string {
  let out = currentLanguage() === 'es' ? es[source] ?? source : source;
  if (currentLanguage() === 'es' && !es[source]) {
    // A note can join several catalogued sentences at runtime ("Every worker starts on this: … Set by Ada 2 h ago.
    // Admins can change it."). Apply patterns in turn, restarting after each hit, so every piece gets translated.
    const seen = new Set([out]);
    for (let pass = 0; pass < 12; pass++) {
      const hit = patterns.find(([pattern]) => pattern.test(out));
      if (!hit) break;
      const next = out.replace(hit[0], hit[1]);
      if (next === out || seen.has(next)) break;
      out = next;
      seen.add(out);
    }
  }
  return fill(out, params);
}
