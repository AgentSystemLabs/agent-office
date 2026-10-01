// The office's words, in every language it speaks. English is the source: every other language
// is typed against it, so a missing or misshapen message fails the typecheck instead of showing up
// blank. Messages that take values are functions, which lets each language do its own plurals.
// Add a language by adding its dictionary below and its tag to LOCALES.

import { en } from './locales/en.js';
import { ptBR } from './locales/pt-BR.js';

export type Messages = typeof en;

export const LOCALES = ['en', 'pt-BR'] as const;
export type Locale = (typeof LOCALES)[number];

const DICTIONARIES: Record<Locale, Messages> = { en, 'pt-BR': ptBR };

export function messages(locale: Locale): Messages {
  return DICTIONARIES[locale];
}

/**
 * The language a tag like `pt-BR`, `pt_BR.UTF-8` or `pt` asks for, or undefined when the office
 * doesn't speak it. A bare language picks its first region we have (`pt` is `pt-BR`).
 */
export function matchLocale(tag: string | undefined): Locale | undefined {
  const clean = (tag ?? '').split('.')[0].split('@')[0].replace('_', '-').trim().toLowerCase();
  if (!clean) return undefined;
  const exact = LOCALES.find((l) => l.toLowerCase() === clean);
  if (exact) return exact;
  const lang = clean.split('-')[0];
  return LOCALES.find((l) => l.toLowerCase().split('-')[0] === lang);
}

/**
 * The language a terminal asks for: AGENT_OFFICE_LANG, then the POSIX variables in the order they
 * override each other (LC_ALL, LC_MESSAGES, LANG). The first one set decides, as it does for other
 * programs, so LANG=C means English even when a later variable says otherwise.
 */
export function envLocale(env: Record<string, string | undefined>): Locale {
  for (const name of ['AGENT_OFFICE_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const value = env[name]?.trim();
    if (value) return matchLocale(value) ?? 'en';
  }
  return 'en';
}

/** A desk or seat's name in a language: shared/layout.ts names them in English, and they're translated here by id. */
export function placeName(m: Messages, place: { id: string; label: string }): string {
  // A map of its own names its seats itself (see shared/maps): those stay as they are.
  if (byId(messages('en'), place) !== place.label) return place.label;
  return byId(m, place) ?? place.label;
}

function byId(m: Messages, place: { id: string; label: string }): string | undefined {
  const names = m.places;
  const n = Number(/-(\d+)$/.exec(place.id)?.[1]);
  if (place.id.startsWith('desk-')) return names.desk(n);
  if (place.id.startsWith('beanbag-')) return names.beanBag(n);
  if (place.id === 'meeting-1') return names.headOfTable;
  if (place.id.startsWith('meeting-')) return names.meetingChair(n);
  const fixed: Record<string, string> = names.fixed;
  return fixed[place.id.replace(/-\d+$/, '')];
}
