// Which language the office's interface speaks. It is a browser setting (part of agent-office.settings),
// so it is shared by the 3D office, the 2D view and the sign-in pages. Spanish is the default.

export type Language = 'es' | 'en';

export const LANGUAGES: readonly Language[] = ['es', 'en'];
export const LANGUAGE_LABELS: Record<Language, string> = { es: '🇪🇸 Español', en: '🇬🇧 English' };

const SETTINGS_KEY = 'agent-office.settings';
const COOKIE = 'agent-office-language';

const listeners = new Set<(language: Language) => void>();
let current: Language = 'es';

export function isLanguage(value: unknown): value is Language {
  return value === 'es' || value === 'en';
}

/** The language saved in this browser, or Spanish on a first visit. */
export function readLanguage(): Language {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
      if (isLanguage(saved?.language)) return saved.language;
    }
    if (typeof document !== 'undefined') {
      const cookie = document.cookie.split('; ').find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      if (isLanguage(cookie)) return cookie;
    }
  } catch {
    // storage blocked
  }
  return 'es';
}

export function currentLanguage(): Language {
  return current;
}

function remember(language: Language) {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...(saved && typeof saved === 'object' ? saved : {}), language }));
    }
    if (typeof document !== 'undefined') {
      document.cookie = `${COOKIE}=${language}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = language;
    }
  } catch {
    // storage blocked
  }
}

/** Changes the interface language and tells every open piece of UI to re-read its strings. */
export function setLanguage(language: Language) {
  if (!isLanguage(language) || language === current) return;
  current = language;
  remember(language);
  listeners.forEach((fn) => fn(language));
}

/** Called once at start-up, before any UI is built. */
export function initLanguage() {
  current = readLanguage();
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}

/** hears a language change; the returned function unsubscribes. */
export function onLanguageChange(fn: (language: Language) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
