import { store, type Settings, type ViewMode } from '../state';
import { h, openModal } from './dom';

const VIEWS: [ViewMode, string, string][] = [
  ['first', '👀 First person', 'See through your own eyes. Click the office to look around with the mouse and click things to use them. Esc frees the mouse.'],
  ['third', '🎥 Third person', 'Follow your character from behind. Drag to orbit the camera, scroll to zoom, and click things to use them.'],
];

export function openSettings(settings: Settings, onChange: (s: Settings) => void, onCharacter: () => void, previewSound: () => void, onSignOut: () => void) {
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

  const volume = h('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Office sounds volume' });
  const pct = h('span.vol-pct');
  const mute = h('button.btn', { type: 'button' });
  const soundRow = h('div.volume', {}, mute, volume, pct);
  const paintSound = () => {
    const level = Math.round(settings.volume * 100);
    volume.value = String(level);
    volume.style.setProperty('--fill', `${level}%`);
    pct.textContent = settings.muted ? 'Muted' : `${level}%`;
    mute.textContent = settings.muted ? '🔊 Unmute' : '🔇 Mute';
    mute.setAttribute('aria-pressed', String(settings.muted));
    mute.classList.toggle('danger', settings.muted);
    soundRow.classList.toggle('muted', settings.muted);
  };
  paintSound();
  // Dragging the slider turns sound back on; letting go plays a sample at the new level.
  volume.addEventListener('input', () => {
    settings = { ...settings, volume: Number(volume.value) / 100, muted: false };
    onChange(settings);
    paintSound();
  });
  volume.addEventListener('change', previewSound);
  mute.addEventListener('click', () => {
    settings = { ...settings, muted: !settings.muted };
    onChange(settings);
    paintSound();
    if (!settings.muted) previewSound();
  });

  const account = store.me.account;
  const character = h('button.btn', { type: 'button' }, account ? '🧍 Change your look' : '🧍 Change your look & name');
  const signOut = h('button.btn', { type: 'button' }, '🚪 Sign out');
  signOut.addEventListener('click', onSignOut);
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Settings' },
    h('header', {}, h('h2', {}, '⚙️ Settings'), close),
    h(
      'div.body',
      {},
      h('label', {}, 'Camera view'),
      seg,
      note,
      h('label', { style: 'margin-top:18px' }, 'Office sounds'),
      soundRow,
      h('p.setting-note', {}, 'Workers typing, footsteps, the coffee machine, birds outside, and the ding when a worker is done. Voice chat isn’t affected.'),
      h('label', { style: 'margin-top:18px' }, 'Your character'),
      character,
      h('label', { style: 'margin-top:18px' }, 'Signed in'),
      h('div.volume', {}, signOut),
      h('p.setting-note', {}, account ? `As ${account.name}, with your own account (${account.role}).` : 'With the shared office password.'),
    ),
  );
  const modal = openModal(el);
  close.addEventListener('click', () => modal.close());
  character.addEventListener('click', () => {
    modal.close();
    onCharacter();
  });
}
