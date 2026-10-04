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
  const input = h('input', { type: 'text', maxlength: MAX_LABEL, placeholder: 'Operations', 'aria-label': "표지판", autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  input.value = old?.text ?? '';
  const preview = h('div.sign-preview', { 'aria-hidden': 'true' });
  const swatches = h('div.swatches', { role: 'radiogroup', 'aria-label': "색상" });
  const ideas = h('div.label-ideas');
  const submit = h('button.btn.primary', { type: 'submit' }, old ? "저장" : "🪧 표지판 걸기") as HTMLButtonElement;
  const remove = old ? (h('button.btn.danger', { type: 'button' }, "떼어내기") as HTMLButtonElement) : null;
  const cancel = h('button.btn', { type: 'button' }, "취소");
  const close = h('button.btn.close', { type: 'button', 'aria-label': "닫기" }, '✕');
  const form = h(
    'form.modal.desklabel',
    { role: 'dialog', 'aria-label': `Sign over ${desk.label}` },
    h('header', {}, h('h2', {}, `🪧 Sign over ${desk.label}`), close),
    h('div.body', {}, preview, h('label', { style: 'margin-top:14px' }, 'What it says'), input, ideas, h('label', { style: 'margin-top:14px' }, "색상"), swatches),
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
    submit.textContent = !text && old ? "떼어내기" : old ? "저장" : "🪧 표지판 걸기";
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

  const modal = openModal(form, { doing: `🪧 ${desk.label} 표지판 작성 중` });
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
  const close = h('button.btn.close', { type: 'button', 'aria-label': "닫기" }, '✕');
  const status = h('div.expand-status');
  const expand = h('button.btn.primary', { type: 'button' }) as HTMLButtonElement;
  const shrink = h('button.btn', { type: 'button' }, '🧱 Wall up the last row') as HTMLButtonElement;
  const el = h(
    'div.modal.expand',
    { role: 'dialog', 'aria-label': "확장 사무실" },
    h('header', {}, h('h2', {}, "🔨 사무실 확장"), close),
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
      h('p', {}, level === 0 ? "북쪽 벽의 징과 모서리 사이 공간으로 사무실을 확장할 수 있습니다." : `전체 ${WING.rows}줄 중 ${level}줄을 확장해 책상 ${level * 2}개를 추가했습니다.`),
      h('div.expand-rows', {}, ...Array.from({ length: WING.rows }, (_, i) => h('span', { class: i < level ? 'on' : '', title: names(i + 1) }, i < level ? '🪑🪑' : '· ·'))),
      full ? h('p.setting-note', {}, "더 이상 확장할 수 없습니다.") : h('p.setting-note', {}, `확장하면 ${names(next)}이(가) 추가됩니다. 책상 앞에서 L을 누르면 표지판을 달 수 있습니다.`),
      busy ? h('p.setting-note.bad', {}, `${busy.label}에 직원이 있습니다. 해당 줄을 줄이려면 먼저 퇴근시키세요.`) : '',
      h('p.setting-note', {}, "같은 층의 모든 참여자에게 적용되며 앱을 재시작해도 유지됩니다."),
    );
    expand.disabled = full;
    expand.textContent = full ? "최대 크기로 확장됨" : level === 0 ? "🔨 사무실 확장 (책상 +2)" : "🔨 한 줄 더 확장 (책상 +2)";
    shrink.disabled = level === 0 || !!busy;
    shrink.style.display = level === 0 ? 'none' : '';
  };
  const off = [store.on('floorPlan', render), store.on('workers', render)];
  const modal = openModal(el, { doing: "🔨 사무실 확장 중", onClose: () => off.forEach((f) => f()) });
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
