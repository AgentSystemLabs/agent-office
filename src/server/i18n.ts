import { envLocale, messages, type Locale, type Messages } from '../shared/i18n.js';

// The office's words on the server, in the language its terminal asks for (AGENT_OFFICE_LANG, else
// the POSIX locale; see ../shared/i18n.ts), or the one an admin picked in ⚙️ Settings (see
// language.ts): its console, the toasts and errors it sends the pages, and what it posts to Slack or
// Discord. One office speaks one language to everyone in it.

export let locale: Locale = envLocale(process.env);

/** The words, looked up as they're used (L.srv.namedDog(…)), so a new language takes at once. */
export const L: Messages = { ...messages(locale) };

/** The office speaks `next` from now on. */
export function setLocale(next: Locale) {
  locale = next;
  Object.assign(L, messages(next));
}
