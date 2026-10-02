import './hud.css';
import { h, openModal } from './dom';
import { HELP_ROWS } from './help';
import { L } from '../i18n';

export function openHelp() {
  const close = h('button.btn.close', { 'aria-label': L.common.close }, '✕');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': L.menu.controls },
    h('header', {}, h('h2', {}, L.help.title), close),
    h('div.body', {}, h('div.help-grid', {}, ...HELP_ROWS.flatMap(([k, v]) => [h('span.key', {}, k), h('span', {}, v)]))),
  );
  const modal = openModal(el);
  close.addEventListener('click', () => modal.close());
}
