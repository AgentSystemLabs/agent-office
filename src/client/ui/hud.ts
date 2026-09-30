import './hud.css';
import { h, openModal } from './dom';
import { HELP_ROWS } from './help';

// The HUD's pieces, each in its own module; the office imports them from here.
export { renderPeople, updateSpeaking } from './people';
export { renderWorkers } from './workers-panel';
export { renderCaffeine } from '../features/coffee/meter';
export { renderChat } from './chat';

export function openHelp() {
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Controls' },
    h('header', {}, h('h2', {}, '🎮 Controls'), close),
    h('div.body', {}, h('div.help-grid', {}, ...HELP_ROWS.flatMap(([k, v]) => [h('span.key', {}, k), h('span', {}, v)]))),
  );
  const modal = openModal(el);
  close.addEventListener('click', () => modal.close());
}
