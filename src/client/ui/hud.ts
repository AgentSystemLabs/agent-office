import { store } from '../state';
import type { Voice } from '../voice';
import { $, h, openModal, STATUS_LABEL } from './dom';
import { usageLabel, usageTitle } from './usage';
import { providerLabel, providerUsageState, resolvedProvider } from './provider';

export function renderPeople(voice: Voice, onEditProfile: () => void) {
  const ul = $('people');
  ul.replaceChildren();
  const peers = [...store.peers.values()].sort((a, b) => (a.id === store.you ? -1 : b.id === store.you ? 1 : a.name.localeCompare(b.name)));
  for (const p of peers) {
    const you = p.id === store.you;
    const mic = !p.voice ? '' : p.muted ? '🔇' : '🎙️';
    const li = h(
      'li',
      { 'data-peer': p.id, title: you ? 'Change your character' : p.name, style: you ? 'cursor:pointer' : '' },
      h('span.dot', { style: `background:${p.color}` }),
      h('span', {}, p.name),
      p.account ? h('span.acct', { title: `Signed in with ${you ? 'your' : 'their'} own account` }, '✓') : null,
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
    const provider = w.kind === 'agent' ? providerLabel(w.provider, store.project) : null;
    const providerKind = w.kind === 'agent' ? resolvedProvider(w.provider, store.project) : undefined;
    const usageState = w.kind === 'agent' ? providerUsageState(w.provider, store.project, w.usage) : undefined;
    const usageNote = usageState === 'untracked' ? ' · usage untracked' : usageState === 'waiting' && providerKind === 'opencode' ? ' · waiting for metrics' : usageState === 'waiting' && providerKind === 'codex' ? ' · waiting for first report' : '';
    const sub = [provider && `⚙️ ${provider}${usageNote}`, w.worktree && `🌿 ${w.worktree.branch}`, w.pr && `🔀 PR #${w.pr.number}`, w.activity || w.title || w.prompt].filter(Boolean).join(' · ');
    ul.append(
      h(
        'li',
        { onclick: () => onOpen(w.id), title: `Open ${w.name}'s terminal` },
        h('span.dot', { style: `background:${w.color}` }),
        h('span.name', {}, w.name, sub ? h('span.sub', {}, sub) : null,
          usageState === 'tracked' && w.usage ? h('span.cost', { title: usageTitle(w.usage, providerKind) }, usageLabel(w.usage, providerKind)) : null),
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
    ...store.chat.slice(-60).map((c) =>
      h('li', {}, h('b', { style: `color:${c.color}`, title: c.account ? `${c.name}, signed in with their own account` : undefined }, c.name), c.account ? h('span.acct', {}, ' ✓') : null, ': ', c.text),
    ),
  );
  log.scrollTop = log.scrollHeight;
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
    ['F', 'Hang a picture from the web on a wall. Look at a picture and press E to move, edit or take it down'],
    ['O', 'Open a pull request for a worker on its own branch, or see the one it has'],
    ['T', 'Chat'],
    ['/', 'Search the chat and every terminal, back to before the office last restarted'],
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
