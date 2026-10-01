import { DRINKS, type Drink } from '../../../shared/rooftop';
import { h, openModal } from '../../ui/dom';
import { L } from '../../i18n';

/** A drink's name in the page's language. */
export function drinkName(d: Drink): string {
  return L.bar.drinks[d.id]?.name ?? d.name;
}

export interface BarOptions {
  /** Had enough: nothing stronger than water or a mocktail. */
  cutOff: boolean;
  order(d: Drink): void;
}

/** How hard a drink hits, for the menu. */
function kick(d: Drink): string {
  if (d.strength < 0) return L.bar.sobers;
  if (d.strength === 0) return L.bar.noAlcohol;
  return d.strength >= 0.55 ? L.bar.strong : d.strength >= 0.4 ? L.bar.medium : L.bar.light;
}

/** The rooftop bar's menu: pick a drink and the bartender pours it. */
export function openBar(opts: BarOptions) {
  const close = h('button.btn.close', { 'aria-label': L.common.close }, '✕');
  const list = h(
    'ul.svc-list',
    {},
    ...DRINKS.map((d) => {
      const refused = opts.cutOff && d.strength > 0;
      const li = h(
        'li',
        {
          tabindex: refused ? -1 : 0,
          role: 'button',
          'aria-disabled': String(refused),
          title: refused ? L.bar.refused : L.bar.order(drinkName(d)),
          style: refused ? 'opacity:.45;cursor:not-allowed' : '',
        },
        h('span.jb-icon', { style: 'font-size:26px' }, d.emoji),
        h('div.svc-main', {}, h('div.svc-title', {}, drinkName(d)), h('div.svc-meta', {}, `${L.bar.drinks[d.id]?.blurb ?? d.blurb} · ${kick(d)}`)),
      );
      const pick = () => {
        if (refused) return;
        modal.close();
        opts.order(d);
      };
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      });
      return li;
    }),
  );
  const el = h(
    'div.modal.jukebox',
    { role: 'dialog', 'aria-label': L.bar.dialog },
    h('header', {}, h('h2', {}, L.bar.title), close),
    h(
      'div.body',
      {},
      opts.cutOff ? h('p.setting-note', { style: 'margin:0 0 12px;font-weight:800' }, L.bar.enough) : null,
      list,
    ),
    h('footer', {}, h('span.grow', {}, L.bar.footer)),
  );
  const modal = openModal(el);
  close.addEventListener('click', () => modal.close());
  setTimeout(() => (list.querySelector('li[tabindex="0"]') as HTMLElement | null)?.focus(), 30);
}
