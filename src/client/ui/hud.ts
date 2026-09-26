import { store, AVATAR_COLORS, saveProfile } from '../state';
import type { Voice } from '../voice';
import { $, h, openModal, STATUS_LABEL } from './dom';
import { fmtCost, usageTitle } from './usage';

export function renderPeople(voice: Voice, onEditProfile: () => void) {
  const ul = $('people');
  ul.replaceChildren();
  const peers = [...store.peers.values()].sort((a, b) => (a.id === store.you ? -1 : b.id === store.you ? 1 : a.name.localeCompare(b.name)));
  for (const p of peers) {
    const you = p.id === store.you;
    const mic = !p.voice ? '' : p.muted ? '🔇' : '🎙️';
    const li = h(
      'li',
      { 'data-peer': p.id, title: you ? 'Edit your name & color' : p.name, style: you ? 'cursor:pointer' : '' },
      h('span.dot', { style: `background:${p.color}` }),
      h('span', {}, p.name),
      you ? h('span.you', {}, '(you)') : null,
      p.sharing ? h('span', { title: 'Sharing screen' }, '🖥️') : null,
      h('span.mic', {}, mic),
    );
    if (you) li.addEventListener('click', onEditProfile);
    ul.append(li);
  }
  $('people-count').textContent = String(peers.length);
  void voice;
}

export function updateSpeaking(voice: Voice) {
  for (const li of document.querySelectorAll<HTMLElement>('#people li[data-peer]')) {
    const lvl = voice.levelOf(li.dataset.peer!);
    li.classList.toggle('speaking', lvl > 0.04);
  }
}

export function renderWorkers(onOpen: (id: string) => void) {
  const ul = $('workers');
  ul.replaceChildren();
  const workers = [...store.workers.values()].sort((a, b) => a.createdAt - b.createdAt);
  for (const w of workers) {
    const sub = `${w.worktree ? `🌿 ${w.worktree.branch} · ` : ''}${w.activity || w.title || w.prompt || ''}`;
    ul.append(
      h(
        'li',
        { onclick: () => onOpen(w.id), title: `Open ${w.name}'s terminal` },
        h('span.dot', { style: `background:${w.color}` }),
        h('span.name', {}, w.name, sub ? h('span.sub', {}, sub) : null),
        w.usage?.calls ? h('span.cost', { title: usageTitle(w.usage) }, fmtCost(w.usage.cost)) : null,
        h('span.pill', { class: w.status }, STATUS_LABEL[w.status] ?? w.status),
      ),
    );
  }
  if (!workers.length) ul.append(h('li.empty', {}, 'Walk up to a desk and press E to hire one'));
  $('worker-count').textContent = workers.length ? String(workers.length) : '';
}

export function renderChat() {
  const log = $('chat-log');
  log.replaceChildren(
    ...store.chat.slice(-60).map((c) => h('li', {}, h('b', { style: `color:${c.color}` }, c.name), ': ', c.text)),
  );
  log.scrollTop = log.scrollHeight;
}

export function openProfile(first: boolean, onSave: (name: string, color: string) => void) {
  let color = store.profile.color;
  const input = h('input', { type: 'text', maxlength: 24, value: first ? '' : store.profile.name, placeholder: 'e.g. Ada', 'aria-label': 'Your name' }) as HTMLInputElement;
  const swatches = h('div.swatches');
  const paint = () => {
    swatches.replaceChildren(
      ...AVATAR_COLORS.map((c) =>
        h('button.swatch', {
          type: 'button',
          style: `background:${c}`,
          class: c === color ? 'sel' : '',
          'aria-label': `Color ${c}`,
          onclick: () => {
            color = c;
            paint();
          },
        }),
      ),
    );
  };
  paint();
  const save = h('button.btn.primary', { type: 'submit' }, first ? 'Enter the office 🚪' : 'Save');
  const form = h(
    'form.modal',
    { role: 'dialog', 'aria-label': 'Your profile' },
    h('header', {}, h('h2', {}, first ? '👋 Welcome to the office' : 'Your profile')),
    h('div.body', {}, h('label', {}, 'Your name'), input, h('label', { style: 'margin-top:14px' }, 'Your color'), swatches),
    h('footer', {}, save),
  ) as HTMLFormElement;
  const modal = openModal(form, { escCloses: !first, backdropCloses: !first });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim().slice(0, 24);
    if (!name) {
      input.focus();
      return;
    }
    store.profile = { name, color };
    saveProfile(store.profile);
    modal.close();
    onSave(name, color);
  });
  setTimeout(() => input.focus(), 30);
}

export function openHelp() {
  const rows: [string, string][] = [
    ['W A S D', 'Walk (hold Shift to run)'],
    ['Space', 'Jump'],
    ['Mouse', 'Look around in first person (click to capture the mouse, Esc to free it)'],
    ['Click / E', 'Use what you look at: hire a worker, open its terminal, read a board, watch the TV'],
    ['Drag / wheel', 'Orbit and zoom the camera in third person'],
    ['P', 'Prompt: give a task to a new or existing worker at the desk you face'],
    ['C', 'Changes: what the worker at the desk you face changed — files and diff, commit, discard, open a PR'],
    ['B', 'Open a shared shell (dev servers, git, tests) at an empty desk'],
    ['R', 'Resume a sleeping worker'],
    ['X', 'Send a worker home (frees the desk)'],
    ['T', 'Chat'],
    ['V / M', 'Join voice / mute'],
    ['Esc', 'Close any window and get back to looking around'],
    ['Ctrl + [', 'Send Esc to a terminal (e.g. to interrupt Claude)'],
    ['⚙️', 'Settings: switch between first and third person'],
  ];
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Controls' },
    h('header', {}, h('h2', {}, '🎮 Controls'), close),
    h('div.body', {}, h('div.help-grid', {}, ...rows.flatMap(([k, v]) => [h('span.key', {}, k), h('span', {}, v)]))),
  );
  const modal = openModal(el);
  close.addEventListener('click', () => modal.close());
}
