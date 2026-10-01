// ⚙️ Settings' languages: yours, under You (this browser's, from the page's own copy of each), and the
// office's, under Building (what the server says in toasts and errors; admins pick it).
import type { Net } from '../net';
import { store } from '../state';
import { LOCALES, type Locale } from '../../shared/i18n';
import { h, timeAgo } from './dom';
import { L, chooseLocale, chosenLocale } from '../i18n';

/** Each language by its own name, as it'd be picked from a list. */
const NAMES: Record<Locale, string> = { en: 'English', 'pt-BR': 'Português (Brasil)' };

function seg(label: string, options: [string, string, boolean][], pick: (value: string) => void, disabled = false): HTMLElement {
  return h(
    'div.seg',
    { role: 'radiogroup', 'aria-label': label },
    ...options.map(([value, text, on]) => h('button.btn', { type: 'button', role: 'radio', 'aria-checked': String(on), class: on ? 'on' : '', disabled, onclick: () => !on && pick(value) }, text)),
  );
}

/** Both settings, made by `frame` from their title and what goes in them, and how to paint the office's afresh. */
export function languageSettings(net: Net, frame: (title: string, scope: 'you' | 'office', body: Node[]) => HTMLElement) {
  const mine = chosenLocale();
  const yours = frame(L.settings2.myLanguage, 'you', [
    seg(L.settings2.myLanguage, [['auto', L.settings2.languageAuto, !mine], ...LOCALES.map((l): [string, string, boolean] => [l, NAMES[l], mine === l])], (v) =>
      chooseLocale(v === 'auto' ? null : (v as Locale)),
    ),
    h('p.setting-note', {}, L.settings2.myLanguageNote),
  ]);
  const officeRow = h('div');
  const officeNote = h('p.setting-note');
  const office = frame(L.settings2.officeLanguage, 'office', [officeRow, officeNote]);
  const paint = () => {
    const { lang, by, at } = store.language;
    const admin = store.me.admin;
    officeRow.replaceChildren(
      seg(
        L.settings2.officeLanguage,
        LOCALES.map((l) => [l, NAMES[l], l === lang]),
        (v) => net.send({ t: 'language.set', lang: v }),
        !admin,
      ),
    );
    officeNote.textContent = `${L.settings2.officeLanguageNote}${by ? ` ${L.settings2.setBy(by, at ? timeAgo(at) : '')}` : ''}${admin ? '' : ` ${L.settings.adminsChange}`}`;
  };
  paint();
  return { yours, office, paint };
}
