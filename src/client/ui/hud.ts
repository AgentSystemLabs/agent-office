import { BUZZ_SECONDS, type Caffeine } from '../caffeine';
import { ROOF, ROOF_NAME } from '../../shared/rooftop';
import { store } from '../state';
import type { Voice } from '../voice';
import type { ChatLine } from '../../shared/protocol';
import { $, h, openModal, STATUS_LABEL } from './dom';
import { usageLabel, usageTitle } from './usage';
import { providerLabel, providerUsageState, resolvedProvider, modelBadge } from './provider';
import { whereabouts } from './whereabouts';
import { DESK_BY_ID } from '../../shared/layout';

/** What the people list last showed, so it's only drawn again when something in it changed. */
let peopleKey = '';

/** The people list in the sidebar. Click yourself to change your character, or anyone else to walk over to them. */
export function renderPeople(voice: Voice, onEditProfile: () => void, onWalkTo: (id: string) => void, force = true) {
  const peers = [...store.peers.values()].sort((a, b) => (a.id === store.you ? -1 : b.id === store.you ? 1 : a.name.localeCompare(b.name)));
  // What each of them is up to changes as they walk about (onto the balcony, up the stairs).
  const doing = peers.map((p) => (p.id === store.you ? undefined : whereabouts(p)));
  const key = peers.map((p, i) => `${p.id}|${doing[i] ?? ''}`).join('\n');
  if (!force && key === peopleKey) return;
  peopleKey = key;
  const ul = $('people');
  ul.replaceChildren();
  peers.forEach((p, i) => {
    const you = p.id === store.you;
    const mic = !p.voice ? '' : p.muted ? '🔇' : '🎙️';
    const sub = doing[i];
    const li = h(
      'li',
      { 'data-peer': p.id, class: 'walk', title: you ? 'Change your character' : `${store.onMyFloor(p) ? 'Walk over to' : 'Take the elevator to'} ${p.name}${sub ? ` (${sub})` : ''}` },
      h('span.dot', { style: `background:${p.color}` }),
      h('span.name', {}, p.name, sub ? h('span.sub', {}, sub) : null),
      p.account ? h('span.acct', { title: `Signed in with ${you ? 'your' : 'their'} own account` }, '✓') : null,
      you ? h('span.you', {}, '(you)') : null,
      // Somewhere else in the building: which floor.
      !you && !store.onMyFloor(p)
        ? p.floor === ROOF
          ? h('span.where', { title: 'Up on the roof' }, `🍸 ${ROOF_NAME}`)
          : h('span.where', { title: 'On another floor' }, `🛗 ${store.floors.find((f) => f.id === p.floor)?.name ?? 'lobby'}`)
        : null,
      p.sharing ? h('span', { title: 'Sharing screen' }, '🖥️') : null,
      h('span.mic', {}, mic),
    );
    li.addEventListener('click', () => (you ? onEditProfile() : onWalkTo(p.id)));
    ul.append(li);
  });
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
    const badge = w.kind === 'agent' ? modelBadge(w.provider, w.model, w.effort) : undefined;
    const sub = [provider && `⚙️ ${provider}${badge ? ` · ${badge}` : ''}${usageNote}`, w.worktree && `🌿 ${w.worktree.branch}`, w.pr && `🔀 PR #${w.pr.number}`, w.activity || w.title || w.prompt].filter(Boolean).join(' · ');
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
  // The count is the workers hired onto desks and bean bags (and a meeting's table): the board agents
  // standing at the Issues, PR and queue kiosks are listed but aren't counted.
  const hired = workers.filter((w) => !DESK_BY_ID.get(w.deskId)?.station).length;
  $('worker-count').textContent = hired ? String(hired) : '';
}

let caffeineKey = '';
/** The caffeine meter: a cup per coffee in a row, and a bar that drains over the buzz's minute. */
export function renderCaffeine(caffeine: Caffeine, now: number) {
  const left = caffeine.left(now);
  const jittery = caffeine.jitter(now) > 0;
  const k = `${Math.ceil(left)}|${caffeine.cups}|${jittery}`;
  if (k === caffeineKey) return;
  caffeineKey = k;
  const el = $('caffeine');
  el.classList.toggle('hidden', !left);
  el.classList.toggle('jittery', jittery);
  if (!left) return;
  $('caffeine-cups').textContent = '☕'.repeat(Math.min(caffeine.cups, 3));
  // The bar eases down a second at a time (see its CSS transition), so aim for where it will be in one.
  $('caffeine-fill').style.width = `${(Math.max(0, left - 1) / BUZZ_SECONDS) * 100}%`;
  $('caffeine-left').textContent = `${Math.ceil(left)}s`;
}

/** How long a chat line stays up before it fades away. Hovering the chat, or typing in it, brings them all back. */
const CHAT_LINGER = 12_000;
/** When this page first showed each line. */
const chatSeen = new WeakMap<ChatLine, number>();

export function renderChat() {
  const log = $('chat-log');
  const now = performance.now();
  log.replaceChildren(
    ...store.chat.slice(-60).map((c) => {
      const seen = chatSeen.get(c) ?? now;
      chatSeen.set(c, seen);
      // Older lines start their fade in the past, so they're already gone.
      return h(
        'li',
        { style: `animation-delay:${Math.round(CHAT_LINGER - (now - seen))}ms` },
        h('b', { style: `color:${c.color}`, title: c.account ? `${c.name}, signed in with their own account` : undefined }, c.name),
        c.account ? h('span.acct', {}, ' ✓') : null,
        ': ',
        c.text,
      );
    }),
  );
  log.scrollTop = log.scrollHeight;
}

export function openHelp() {
  const rows: [string, string][] = [
    ['W A S D', 'Walk (hold Shift to run)'],
    ['Space', 'Jump'],
    ['☕', 'Press E at the coffee machine in the kitchen for a minute of quicker walking and higher jumps. Three cups in a row gives you the jitters'],
    ['Mouse', 'Look around in first person (click to capture the mouse, Esc to free it)'],
    ['Click / E', "Use what you look at: hire a worker, open its terminal, read a board, call a meeting in the meeting room, watch the TV, put a song on the jukebox, sit on a couch, a beanbag, a chair or the balcony bench (walk off to get up)"],
    ['👥', 'Click someone under "In the office" to walk over to them (on another floor, you ride the elevator first). The line under their name says what they have open or where they are'],
    ['🛗', 'Every project is a floor: step into the elevator on the north wall and press E (or click the project name, top left) to go to another one or add a project'],
    ['🤖', 'An agent stands by the issues board, the PR board and the task queue. Press E at one and type what you want: it runs as an agent that knows that board. O there opens its terminal, X sends it home'],
    ['📝', 'The whiteboard on wheels between the desks and the lounge: press E to draw on it with everyone on your floor, live. What you draw stays up on the board'],
    ['🕹️', 'The arcade cabinet in the lounge plays BLOCKFALL: arrows (or WASD) move and turn, Space drops, C holds, P pauses. Everyone on the floor sees your game on it, and E there watches whoever is playing. One of your workers needing input pauses it'],
    ['🎉', 'Whenever a pull request merges, the gong next to the PR board rings, confetti rains down all over the floor and every worker gets up on its desk for a quick dance. Walk up to the gong and press E to bang it yourself'],
    ['N', "Next worker that needs you: go to whoever has waited longest (needs input, or done and nobody's looked), and again for the next one. Arrows at the edge of the screen point to the ones out of sight"],
    ['🍸', 'The elevator goes up to the rooftop bar: a DJ playing drum and bass under the lights, and the city all around. Press E at the bar for a drink (it goes to your head for a bit) and at the DJ booth for the air horn'],
    ['Drag / wheel', 'Orbit and zoom the camera in third person'],
    ['P', 'Prompt: give a task to a new or existing worker at the desk you face'],
    ['C', 'Changes: what the worker at the desk you face changed — files and diff, commit, discard, open a PR'],
    ['B', 'Open a shared shell (dev servers, git, tests) at an empty desk'],
    ['R', 'Resume a sleeping worker'],
    ['X', 'Send a worker home (frees the desk)'],
    ['F', 'Hang a picture from the web on a wall. Look at a picture and press E to move, edit or take it down'],
    ['Q', 'Put back the issue card in your hands (E at a note on the issues board, or ✋ Pick it up in an issue; then E at an empty desk, a worker or the queue board)'],
    ['🐶', 'Walk up to the office dog and press E to pet it. When a worker needs input, it runs to that desk and barks. Name it in ⚙️ Settings'],
    ['O', 'Open a pull request for a worker on its own branch, or see the one it has'],
    ['T', 'Chat'],
    ['G / 1–6', 'Emote: hold G, point at one and let go (or tap G and click one), or press 1–6: wave, thumbs up, clap, dance, point, facepalm. Everyone on your floor sees it'],
    ['/', 'Search the chat and every terminal on your floor, back to before the office last restarted'],
    ['V / M', 'Join voice / mute'],
    ['Tab', 'The ☰ menu, top right: every window, and what shows on screen. Pin what you use most to the top bar'],
    ['Esc', 'Close any window and get back to looking around'],
    ['Ctrl + [', 'Send Esc to a terminal (e.g. to interrupt Claude)'],
    ['⚙️', 'Settings (in the ☰ menu): switch between first and third person'],
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
