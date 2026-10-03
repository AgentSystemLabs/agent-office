import { DRINKS, FOODS, type MenuItem } from '../../../shared/rooftop';
import { h, openModal } from '../../ui/dom';

export interface MenuOptions {
  order(item: MenuItem): void;
}

/** The rooftop café's menu: pick a drink or a bite and the barista makes it. */
export function openMenu(opts: MenuOptions) {
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const section = (title: string, items: readonly MenuItem[]) => [
    h('h3', { style: 'margin:14px 0 6px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.7' }, title),
    h(
      'ul.svc-list',
      {},
      ...items.map((item) => {
        const li = h(
          'li',
          { tabindex: 0, role: 'button', title: `Order ${item.name.toLowerCase()}` },
          h('span.jb-icon', { style: 'font-size:26px' }, item.emoji),
          h('div.svc-main', {}, h('div.svc-title', {}, item.name), h('div.svc-meta', {}, item.blurb)),
        );
        const pick = () => {
          modal.close();
          opts.order(item);
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
    ),
  ];
  const el = h(
    'div.modal.jukebox',
    { role: 'dialog', 'aria-label': 'Café menu' },
    h('header', {}, h('h2', {}, '☕ Rooftop café'), close),
    h('div.body', {}, ...section('Drinks', DRINKS), ...section('Food', FOODS)),
    h('footer', {}, h('span.grow', {}, 'Everything is on the house, and all of it is alcohol-free and pork-free.')),
  );
  const modal = openModal(el);
  close.addEventListener('click', () => modal.close());
  setTimeout(() => (el.querySelector('li[tabindex="0"]') as HTMLElement | null)?.focus(), 30);
}
