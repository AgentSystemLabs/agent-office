import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LanguageState } from '../shared/protocol.js';
import { matchLocale, type Locale } from '../shared/i18n.js';
import { locale, setLocale } from './i18n.js';

/**
 * The language the office speaks (⚙️ Settings, admins only): its console, the toasts and errors it
 * sends the pages, and what it posts to Slack or Discord. Kept in .agent-office/language.json; until
 * an admin picks one it's the language the office was started in (see ./i18n.ts). Each person's own
 * pages are in whatever language they picked for themselves, or their browser's.
 */
export class OfficeLanguage {
  private saved?: Required<LanguageState>;
  private path: string;

  constructor(
    dataDir: string,
    private onState: (state: LanguageState) => void,
  ) {
    this.path = path.join(dataDir, 'language.json');
    this.restore();
    if (this.saved) setLocale(this.saved.lang);
  }

  state(): LanguageState {
    return this.saved ? { ...this.saved } : { lang: locale };
  }

  set(lang: Locale, by: string) {
    this.saved = { lang, by, at: Date.now() };
    setLocale(lang);
    try {
      writeFileSync(this.path, JSON.stringify(this.saved, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down: it speaks it until a restart
    }
    this.onState(this.state());
  }

  private restore() {
    try {
      const s = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<LanguageState>;
      const lang = matchLocale(typeof s.lang === 'string' ? s.lang : undefined);
      if (lang) this.saved = { lang, by: typeof s.by === 'string' ? s.by : 'someone', at: typeof s.at === 'number' ? s.at : 0 };
    } catch {
      // never set: the language it was started in
    }
  }
}
