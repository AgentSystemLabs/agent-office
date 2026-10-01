import './ui.css';
import { FURNISH_SLOTS, FURNISH_SLOT_IDS, type FurnishSlotId, type FurnishVariant } from '../../../shared/furnishings';
import type { ClientMsg } from '../../../shared/protocol';
import { store } from '../../state';
import { h, openModal } from '../../ui/dom';

// The wardrobe's window: each kind of furnishing on the floor, with the looks it can have. A click
// swaps it for everyone on the floor; the window follows along when someone else swaps something.

export interface WardrobeDeps {
  send(msg: ClientMsg): void;
}

/** A variant's swatch: a stripe of each of its colors, or a crossed-out box for none. */
function swatch(v: FurnishVariant): HTMLElement {
  const el = h('span.wd-swatch', { 'aria-hidden': 'true' });
  if (!v.colors.length) el.classList.add('none');
  else el.style.background = `linear-gradient(90deg, ${v.colors.map((c, i) => `${c} ${(i / v.colors.length) * 100}% ${((i + 1) / v.colors.length) * 100}%`).join(', ')})`;
  return el;
}

export function openWardrobe(deps: WardrobeDeps) {
  const rows = new Map<FurnishSlotId, HTMLElement>();
  const paint = () => {
    for (const slot of FURNISH_SLOT_IDS) {
      const row = rows.get(slot)!;
      const on = store.furnishings[slot];
      row.replaceChildren(
        ...FURNISH_SLOTS[slot].variants.map((v) =>
          h(
            'button.btn.wd-pick',
            {
              type: 'button',
              role: 'radio',
              'aria-checked': String(v.id === on),
              class: v.id === on ? 'on' : '',
              title: v.label,
              onclick: () => {
                if (v.id !== store.furnishings[slot]) deps.send({ t: 'furnish.set', slot, variant: v.id });
              },
            },
            swatch(v),
            h('span', {}, v.label),
          ),
        ),
      );
    }
  };
  const body = h(
    'div.body',
    {},
    ...FURNISH_SLOT_IDS.map((slot) => {
      const row = h('div.wd-row', { role: 'radiogroup', 'aria-label': FURNISH_SLOTS[slot].label });
      rows.set(slot, row);
      return h('section.wd-slot', {}, h('h3', {}, `${FURNISH_SLOTS[slot].icon} ${FURNISH_SLOTS[slot].label}`), row);
    }),
  );
  paint();
  const el = h(
    'div.modal.wardrobe',
    { role: 'dialog', 'aria-label': 'Wardrobe' },
    h('header', {}, h('h2', {}, '🧥 Wardrobe')),
    body,
    h('footer', {}, h('span.grow', {}, 'Swap what this floor is furnished with. Everyone on the floor sees it, and it stays that way.')),
  );
  const off = store.on('furnishings', paint);
  openModal(el, { onClose: off });
  setTimeout(() => (el.querySelector('.wd-pick.on') as HTMLElement | null)?.focus(), 30);
}
