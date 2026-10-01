/** Camera view (first / third person) controls for ⚙️ Settings. */
import type { Settings, ViewMode } from '../state';
import { h } from './dom';

const VIEWS: [ViewMode, string, string][] = [
  ['first', '👀 First person', 'See through your own eyes. Click the office to look around with the mouse and click things to use them. Esc frees the mouse.'],
  ['third', '🎥 Third person', 'Follow your character from behind. Drag to orbit the camera, scroll to zoom, and click things to use them.'],
];

/** First / third person segment control and its note. `get` is the live settings object. */
export function cameraViewSetting(get: () => Settings, onChange: (s: Settings) => void): { row: HTMLElement; note: HTMLElement } {
  const row = h('div.seg', { role: 'radiogroup', 'aria-label': 'Camera view' });
  const note = h('p.setting-note');
  const paint = () => {
    const settings = get();
    row.replaceChildren(
      ...VIEWS.map(([view, label]) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(settings.view === view),
            class: settings.view === view ? 'on' : '',
            onclick: () => {
              if (get().view === view) return;
              onChange({ ...get(), view });
              paint();
            },
          },
          label,
        ),
      ),
    );
    note.textContent = VIEWS.find(([v]) => v === get().view)![2];
  };
  paint();
  return { row, note };
}
