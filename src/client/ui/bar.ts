import { DRINKS, type Drink } from '../../shared/rooftop';
import { h, openModal } from './dom';

export interface BarOptions {
  /** Had enough: nothing stronger than water or a mocktail. */
  cutOff: boolean;
  order(d: Drink): void;
}

/** How hard a drink hits, for the menu. */
function kick(d: Drink): string {
  if (d.strength < 0) return '💧 sobers you up a little';
  if (d.strength === 0) return 'no alcohol';
  return d.strength >= 0.55 ? '🌀🌀🌀 strong' : d.strength >= 0.4 ? '🌀🌀 goes to your head' : '🌀 light';
}

/** The rooftop bar's menu: pick a drink and the bartender pours it. */
export function openBar(opts: BarOptions) {
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
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
          title: refused ? "The bartender won't pour you another" : `Order a ${d.name.toLowerCase()}`,
          style: refused ? 'opacity:.45;cursor:not-allowed' : '',
        },
        h('span.jb-icon', { style: 'font-size:26px' }, d.emoji),
        h('div.svc-main', {}, h('div.svc-title', {}, d.name), h('div.svc-meta', {}, `${d.blurb} · ${kick(d)}`)),
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
    { role: 'dialog', 'aria-label': 'Bar' },
    h('header', {}, h('h2', {}, '🍸 Sky Bar'), close),
    h(
      'div.body',
      {},
      opts.cutOff ? h('p.setting-note', { style: 'margin:0 0 12px;font-weight:800' }, "🙅 The bartender thinks you've had enough. Water's on the house.") : null,
      list,
    ),
    h('footer', {}, h('span.grow', {}, 'Drinks go to your head for a minute or so, and the view goes with them. Everything is on the house.')),
  );
  const modal = openModal(el);
  close.addEventListener('click', () => modal.close());
  setTimeout(() => (list.querySelector('li[tabindex="0"]') as HTMLElement | null)?.focus(), 30);
}
