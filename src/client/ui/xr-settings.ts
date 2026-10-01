/** VR rendering controls for ⚙️ Settings (kept out of settings.ts for the size guard). */
import type { Settings } from '../state';
import { h } from './dom';

/** A Faster / Outline segment control for WebXR, plus its note. `get` is the live settings object. */
export function xrOutlineSetting(get: () => Settings, onChange: (s: Settings) => void): { row: HTMLElement; note: HTMLElement } {
  const row = h('div.seg', { role: 'radiogroup', 'aria-label': 'VR outline' });
  const note = h(
    'p.setting-note',
    {},
    'On a Quest, prefer Faster. Outline keeps the cartoon edges in VR but costs frames; the office also drops the outline by itself if the headset falls below about 72 fps.',
  );
  const paint = () => {
    const settings = get();
    row.replaceChildren(
      ...(
        [
          [false, '⚡ Faster'],
          [true, '✏️ Outline'],
        ] as const
      ).map(([on, label]) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(settings.xrOutline === on),
            class: settings.xrOutline === on ? 'on' : '',
            onclick: () => {
              if (get().xrOutline === on) return;
              onChange({ ...get(), xrOutline: on });
              paint();
            },
          },
          label,
        ),
      ),
    );
  };
  paint();
  return { row, note };
}
