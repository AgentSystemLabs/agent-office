import { LOCALES, matchLocale, messages, placeName, type Locale } from '../shared/i18n';
import { localizeMaps, type MapConfig } from '../shared/maps';

// The language the page speaks: the browser's, the first of its languages the office knows.
// `?lang=pt-BR` or `?lang=en` in the address picks one and remembers it for this browser.

const KEY = 'agent-office-lang';

function pickLocale(): Locale {
  try {
    // For this page only: a shared link with ?lang= doesn't change what its reader picked for themselves.
    const asked = matchLocale(new URLSearchParams(location.search).get('lang') ?? undefined);
    if (asked) return asked;
    const saved = matchLocale(localStorage.getItem(KEY) ?? undefined);
    if (saved) return saved;
  } catch {
    // no storage (a private window): go by the browser
  }
  for (const tag of typeof window === 'undefined' ? [] : (navigator.languages ?? [navigator.language])) {
    const l = matchLocale(tag);
    if (l) return l;
  }
  return LOCALES[0];
}

export const locale = pickLocale();

/** The language picked for this browser in ⚙️ Settings, or null to go by the browser's own. */
export function chosenLocale(): Locale | null {
  try {
    return matchLocale(localStorage.getItem(KEY) ?? undefined) ?? null;
  } catch {
    return null;
  }
}

/** Picks `l` for this browser (null: the browser's own) and reloads the page in it. */
export function chooseLocale(l: Locale | null) {
  try {
    if (l) localStorage.setItem(KEY, l);
    else localStorage.removeItem(KEY);
  } catch {
    // no storage: it can only go by the address (?lang=)
  }
  const url = new URL(location.href);
  url.searchParams.delete('lang');
  if (l) url.searchParams.set('lang', l);
  location.replace(url.toString());
}
if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = locale;

/** The page's words, in its language (see ../shared/locales). */
export const L = messages(locale);

// The built-in maps in the page's language: their names, lines, tables and boards (ids stay as they are).
localizeMaps({
  office: L.maps.office,
  seat: L.maps.seat,
  table: L.maps.table,
  map: (c: MapConfig): MapConfig => {
    if (c.id !== 'castle') return c;
    const t = L.maps.castle;
    return {
      ...c,
      name: t.name,
      description: t.description,
      herald: c.herald && { ...c.herald, ...t.herald },
      tables: c.tables.map((table, i) => ({ ...table, name: t.tables[i] ?? table.name })),
      boards: c.boards && (Object.fromEntries(Object.entries(c.boards).map(([k, b]) => [k, b && { ...b, label: t.boards[k] ?? b.label }])) as typeof c.boards),
      sendHome: c.sendHome && {
        ...c.sendHome,
        escort: c.sendHome.escort && { ...c.sendHome.escort, name: t.escort },
        steps: c.sendHome.steps?.map((s, i) => (s.do === 'say' && t.says[i] ? { ...s, text: t.says[i] } : s)),
      },
    };
  },
});

/** The message at a dotted path like `hud.people`, or undefined when there's none. */
function lookup(path: string): string | undefined {
  let v: unknown = L;
  for (const part of path.split('.')) v = (v as Record<string, unknown> | undefined)?.[part];
  return typeof v === 'string' ? v : undefined;
}

/** The attributes a page's HTML marks for translation, and what each one sets. */
const MARKS: [string, (el: HTMLElement, text: string) => void][] = [
  ['data-t', (el, text) => (el.textContent = text)],
  ['data-t-title', (el, text) => (el.title = text)],
  ['data-t-placeholder', (el, text) => el.setAttribute('placeholder', text)],
  ['data-t-aria-label', (el, text) => el.setAttribute('aria-label', text)],
];

/** Puts the words into a page's HTML: each element marked `data-t="hud.people"` (and the -title, -placeholder, -aria-label kinds) gets that message. */
export function translatePage(root: ParentNode = document) {
  for (const [attr, set] of MARKS)
    for (const el of root.querySelectorAll<HTMLElement>(`[${attr}]`)) {
      const text = lookup(el.getAttribute(attr)!);
      if (text !== undefined) set(el, text);
    }
}

/** A desk or seat's name in the page's language (see placeName in ../shared/i18n.ts). */
export function placeLabel(place: { id: string; label: string }): string {
  return placeName(L, place);
}

/** A worker's name as people read it: the board agents' ("Issues agent") in the page's language; everyone else's as it is. */
export function workerName(name: string): string {
  return L.boards.agentTags[name] ?? name;
}

/** A board's title over it, in the page's language (the layout names them in English). */
export function boardLabel(key: string, label: string): string {
  return L.boards.boardTitles[key] ?? label;
}

/** A garage car's name in the page's language. */
export function carName(car: { name: string }): string {
  return L.cars[car.name] ?? car.name;
}

/** A meeting pattern's name, line and rounds note in the page's language (shared/meetings.ts has them in English). */
export function patternText(id: string): { label: string; blurb: string; roundsNote: string } | undefined {
  return L.meetings.patterns[id];
}

export function patternLabel(id: string): string {
  return patternText(id)?.label ?? id;
}

/** A meeting seat's role, which the server names in English (see shared/meetings.ts). */
export function roleLabel(role: string): string {
  return L.meetings.roles[role] ?? role;
}
