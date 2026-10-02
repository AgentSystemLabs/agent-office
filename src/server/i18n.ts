import { envLocale, messages, type Locale, type Messages } from '../shared/i18n.js';

// The office's words on the server, in the language AGENT_OFFICE_LANG asks for, or the one an admin
// picked in ⚙️ Settings (see language.ts), else English: its console, the toasts and errors it sends
// the pages, and what it posts to Slack or Discord. One office speaks one language to everyone in it.
// Not the terminal's LANG: an office already running on a Portuguese machine doesn't start posting
// in Portuguese on an upgrade without anyone asking for it.

export let locale: Locale = envLocale({ AGENT_OFFICE_LANG: process.env.AGENT_OFFICE_LANG });

/** The words, looked up as they're used (L.srv.namedDog(…)), so a new language takes at once. */
export const L: Messages = { ...messages(locale) };

/** The office speaks `next` from now on. */
export function setLocale(next: Locale) {
  locale = next;
  Object.assign(L, messages(next));
}
