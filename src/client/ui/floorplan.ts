import './floorplan.css';
import { LABEL_IDEAS, MAX_LABEL, SIGN_COLORS, cleanLabel, rowDesks, signColor, signInk } from '../../shared/floorplan';
import { DESK_BY_ID, WING } from '../../shared/layout';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal } from './dom';

const COLOR_KEY = 'agent-office.signColor';
function lastColor(): string {
  try {
    return signColor(localStorage.getItem(COLOR_KEY));
  } catch {
    return SIGN_COLORS[0].color;
  }
}

/** L at a desk: what the sign over it says (and its color), or take it down. */
export function openDeskLabel(net: Net, deskId: string) {
  const desk = DESK_BY_ID.get(deskId);
  if (!desk) return;
  const old = store.floorPlan.labels[deskId];
  let color = old?.color ?? lastColor();
  const input = h('input', { type: 'text', maxlength: MAX_LABEL, placeholder: 'Operations', 'aria-label': 'Sign', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  input.value = old?.text ?? '';
  const preview = h('div.sign-preview', { 'aria-hidden': 'true' });
  const swatches = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Color' });
  const ideas = h('div.label-ideas');
  const submit = h('button.btn.primary', { type: 'submit' }, old ? 'Save' : '🪧 Hang it') as HTMLButtonElement;
  const remove = old ? (h('button.btn.danger', { type: 'button' }, 'Take it down') as HTMLButtonElement) : null;
  const cancel = h('button.btn', { type: 'button' }, 'Cancel');
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕');
  const form = h(
    'form.modal.desklabel',
    { role: 'dialog', 'aria-label': `Sign over ${desk.label}` },
    h('header', {}, h('h2', {}, `🪧 Sign over ${desk.label}`), close),
    h('div.body', {}, preview, h('label', { style: 'margin-top:14px' }, 'What it says'), input, ideas, h('label', { style: 'margin-top:14px' }, 'Color'), swatches),
    h('footer', {}, h('span.grow', {}, 'It hangs from the ceiling over the desk, for everyone on this floor.'), remove, cancel, submit),
  ) as HTMLFormElement;
  form.noValidate = true;

  const render = () => {
    const text = cleanLabel(input.value);
    preview.style.background = color;
    preview.style.color = signInk(color);
    preview.textContent = text || 'Operations';
    preview.classList.toggle('placeholder', !text);
    submit.disabled = !text && !old;
    submit.textContent = !text && old ? 'Take it down' : old ? 'Save' : '🪧 Hang it';
    for (const b of swatches.children) (b as HTMLElement).classList.toggle('sel', (b as HTMLElement).dataset.color === color);
  };
  swatches.replaceChildren(
    ...SIGN_COLORS.map((c) =>
      h('button.swatch', {
        type: 'button',
        role: 'radio',
        title: c.name,
        'aria-label': c.name,
        'data-color': c.color,
        style: `background:${c.color}`,
        onclick: () => {
          color = c.color;
          try {
            localStorage.setItem(COLOR_KEY, color);
          } catch {
            // private mode: the color just isn't remembered
          }
          render();
        },
      }),
    ),
  );
  ideas.replaceChildren(
    ...LABEL_IDEAS.map((idea) =>
      h(
        'button.btn',
        {
          type: 'button',
          onclick: () => {
            input.value = idea;
            render();
            input.focus();
          },
        },
        idea,
      ),
    ),
  );
  input.addEventListener('input', render);

  const modal = openModal(form, { doing: `🪧 labeling ${desk.label}` });
  const send = (text: string) => {
    net.send({ t: 'desk.label', deskId, text, color });
    modal.close();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = cleanLabel(input.value);
    if (text || old) send(text);
  });
  remove?.addEventListener('click', () => send(''));
  cancel.addEventListener('click', () => modal.close());
  close.addEventListener('click', () => modal.close());
  render();
  input.focus();
  input.select();
}

/** E at the sign in the back office (or on the wall where it goes through): build it out, or wall it up. */
export function openExpand(net: Net) {
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕');
  const status = h('div.expand-status');
  const expand = h('button.btn.primary', { type: 'button' }) as HTMLButtonElement;
  const shrink = h('button.btn', { type: 'button' }, '🧱 Wall up the last row') as HTMLButtonElement;
  const el = h(
    'div.modal.expand',
    { role: 'dialog', 'aria-label': 'Back office' },
    h('header', {}, h('h2', {}, '🔨 Back office'), close),
    h('div.body', {}, status),
    h('footer', {}, shrink, expand),
  );
  const names = (row: number) =>
    rowDesks(row)
      .map((d) => d.label)
      .join(' and ');
  const render = () => {
    const level = store.floorPlan.wing;
    const full = level >= WING.rows;
    const next = level + 1;
    const last = level > 0 ? rowDesks(level) : [];
    const busy = last.find((d) => store.workerAtDesk(d.id));
    status.replaceChildren(
      h('p', {}, level === 0 ? 'The office has room to grow through the north wall, between the gong and the corner.' : `The back office is built out ${level} of ${WING.rows} rows, with ${level * 2} more desks.`),
      h('div.expand-rows', {}, ...Array.from({ length: WING.rows }, (_, i) => h('span', { class: i < level ? 'on' : '', title: names(i + 1) }, i < level ? '🪑🪑' : '· ·'))),
      full ? h('p.setting-note', {}, "It can't go back any further.") : h('p.setting-note', {}, `Knocking through brings ${names(next)}, each with its own sign to hang (press L at a desk).`),
      busy ? h('p.setting-note.bad', {}, `Someone's at ${busy.label}: send them home before walling that row up.`) : '',
      h('p.setting-note', {}, 'It changes the floor for everyone on it, and stays built across restarts.'),
    );
    expand.disabled = full;
    expand.textContent = full ? 'Built all the way out' : level === 0 ? '🔨 Knock through (+2 desks)' : '🔨 Another row (+2 desks)';
    shrink.disabled = level === 0 || !!busy;
    shrink.style.display = level === 0 ? 'none' : '';
  };
  const off = [store.on('floorPlan', render), store.on('workers', render)];
  const modal = openModal(el, { doing: '🔨 in the back office', onClose: () => off.forEach((f) => f()) });
  expand.addEventListener('click', () => {
    net.send({ t: 'floor.expand' });
    modal.close();
  });
  shrink.addEventListener('click', () => {
    net.send({ t: 'floor.shrink' });
    modal.close();
  });
  close.addEventListener('click', () => modal.close());
  render();
}
