import type { Settings, ViewMode } from '../state';
import { h, openModal } from './dom';

const VIEWS: [ViewMode, string, string][] = [
  ['first', '👀 First person', 'See through your own eyes. Click the office to look around with the mouse and click things to use them. Esc frees the mouse.'],
  ['third', '🎥 Third person', 'Follow your character from behind. Drag to orbit the camera, scroll to zoom, and click things to use them.'],
];

export function openSettings(settings: Settings, onChange: (s: Settings) => void, onCharacter: () => void) {
  const seg = h('div.seg', { role: 'radiogroup', 'aria-label': 'Camera view' });
  const note = h('p.setting-note');
  const paint = () => {
    seg.replaceChildren(
      ...VIEWS.map(([view, label]) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(settings.view === view),
            class: settings.view === view ? 'on' : '',
            onclick: () => {
              if (settings.view === view) return;
              settings = { ...settings, view };
              onChange(settings);
              paint();
            },
          },
          label,
        ),
      ),
    );
    note.textContent = VIEWS.find(([v]) => v === settings.view)![2];
  };
  paint();
  const character = h('button.btn', { type: 'button' }, '🧍 Change your look & name');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Settings' },
    h('header', {}, h('h2', {}, '⚙️ Settings'), close),
    h('div.body', {}, h('label', {}, 'Camera view'), seg, note, h('label', { style: 'margin-top:18px' }, 'Your character'), character),
  );
  const modal = openModal(el);
  close.addEventListener('click', () => modal.close());
  character.addEventListener('click', () => {
    modal.close();
    onCharacter();
  });
}
