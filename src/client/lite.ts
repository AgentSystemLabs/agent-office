// The 2D view (/lite): the office without the 3D, for a phone or a computer the 3D office is too
// much for. Every worker on the floor and how it's doing, the ones waiting on someone first; its
// terminal, with the keys a phone's keyboard hasn't got and a box to send it a prompt; and the boards
// and the task queue. You're in the office as someone on the 2D view (PeerInfo.lite), not standing
// anywhere in it.

import { Net } from './net';
import { AVATAR_COLORS, loadProfile, loadSettings, saveProfile, store } from './state';
import { randomLook } from '../shared/avatar';
import { cloneLabel } from '../shared/floors';
import { ROOF } from '../shared/rooftop';
import { DESK_BY_ID, nextFreeSeat } from '../shared/layout';
import { isAsleep } from '../shared/status';
import type { AgentEffort, AgentProvider, FloorInfo, WorkerInfo } from '../shared/protocol';
import { $, clip, closeAllModals, doingNow, h, onDoingChange, onModalChange, openModal, readingNow, STATUS_LABEL, timeAgo, toast } from './ui/dom';
import { openTerminal, openTerminalFor, routeTerminalMessage } from './ui/terminal';
import { openChanges, openChangesFor, routeChangesMessage } from './ui/changes';
import { lostWorktreeDialog, openPrompt, routeWorktreeMessage, sendHomeDialog } from './ui/prompt';
import { openBoard } from './ui/boards';
import type { BoardActions } from './ui/github/prompts';
import { openPull, routePullMessage } from './ui/pull';
import { openQueue } from './ui/queue';
import { openAsk } from './ui/ask';
import { openMeeting, type MeetingPreset } from './ui/meeting';
import { openSignIns } from './ui/signins';
import { modelBadge, providerLabel } from './ui/provider';
import { byUrgency, waitingInOrder, waitingLabel } from './nextup';
import { askNotifyPermission, DesktopNotifier, notifyPermission, waitingOnSomeone } from './notify';
import { repoChoices } from './shared/hiring';
// The tab title counts the workers waiting on someone, on every floor, as the 3D office's does.
import { renderTitle } from './shared/title';

// Sent here because this browser can't draw the 3D office (see noWebGL in core/scene.ts).
if (new URLSearchParams(location.search).get('why') === 'webgl') {
  history.replaceState(null, '', location.pathname);
  toast("This browser can't draw the 3D office (WebGL is off or missing), so here's the 2D view", 'warn');
}

// Your name and color from the 3D office, if this browser has been in it. Nobody sees a character
// of yours from here, so a look is only made up to connect with.
const saved = loadProfile();
store.profile = { name: saved?.name ?? 'Guest', color: saved?.color ?? AVATAR_COLORS[1], look: saved?.look ?? randomLook() };
const net = new Net(() => store.profile, () => null, true);
const settings = loadSettings();
const notifier = new DesktopNotifier(() => settings.notify, (id) => openWorker(id));

/** The server version this page was loaded with. */
let bootVersion = '';

net.onStatus((up) => $('conn').classList.toggle('hidden', up));
net.onMessage((msg) => {
  store.apply(msg);
  routeTerminalMessage(msg);
  routeChangesMessage(msg);
  routePullMessage(msg);
  routeWorktreeMessage(msg);
  switch (msg.t) {
    case 'welcome': {
      // Back from a restart on another version: this page's code is stale, so load the new one.
      if (!bootVersion) bootVersion = msg.version;
      else if (msg.version !== bootVersion) return location.reload();
      offTheRoof();
      // After a reconnect the server has forgotten which terminal we had open, and what we're doing.
      sendDoing(true);
      const openId = openTerminalFor();
      if (openId && store.workers.has(openId)) net.send({ t: 'worker.attach', workerId: openId });
      const watching = openChangesFor();
      if (watching && store.workers.has(watching.workerId)) net.send({ t: 'changes.watch', ...watching });
      break;
    }
    case 'floor.enter':
      offTheRoof();
      break;
    case 'toast':
      toast(msg.text, msg.level);
      break;
    case 'signins.needed':
      openSignIns(net, msg.why);
      break;
    case 'upgrade':
      if (msg.state.phase === 'restarting') {
        net.expectRestart();
        toast('⬆️ The office is restarting on its new version. Back in a minute.');
      }
      break;
  }
});

/** Nothing to see up on the roof from here: down to the first floor instead (the 3D office left you up there, say). */
function offTheRoof() {
  if (store.floor !== ROOF) return;
  const to = store.floors.find((f) => !f.cloning);
  if (to) net.send({ t: 'floor.go', floor: to.id });
}

// ---- The floor you're on ------------------------------------------------------------------------
const floorSelect = $('floor') as HTMLSelectElement;
const floorLabel = (f: FloorInfo) => `${f.name}${f.cloning ? ` (${cloneLabel(f.clone)})` : f.waiting ? ` · 🙋 ${f.waiting}` : ''}`;

function renderFloors() {
  const options = store.floors.map((f) => h('option', { value: f.id, disabled: !!f.cloning }, floorLabel(f)));
  if (!store.floors.length) options.push(h('option', { value: '' }, 'No floors yet'));
  floorSelect.replaceChildren(...options);
  floorSelect.value = store.floor ?? '';
  floorSelect.disabled = store.floors.length < 2;
  const p = store.project;
  const f = store.currentFloor();
  $('floor-meta').textContent = p ? [p.branch && `⎇ ${p.branch}`, f?.repo ?? p.dir, f && `👥 ${f.people} here`].filter(Boolean).join(' · ') : store.floors.length ? '' : 'Add a project from the elevator in the 3D office.';
  // Someone waiting on another floor: a way straight there.
  const elsewhere = store.floors.filter((o) => o.id !== store.floor && o.waiting > 0 && !o.cloning);
  const box = $('elsewhere');
  box.classList.toggle('hidden', !elsewhere.length);
  box.replaceChildren(
    ...elsewhere.map((o) =>
      h('button.btn.lite-go', { type: 'button', onclick: () => net.send({ t: 'floor.go', floor: o.id }) }, `🙋 ${o.waiting} waiting on ${o.name}`, h('span', { 'aria-hidden': 'true' }, '→')),
    ),
  );
  renderTitle();
}
floorSelect.addEventListener('change', () => {
  if (floorSelect.value && floorSelect.value !== store.floor) net.send({ t: 'floor.go', floor: floorSelect.value });
});
store.on('floors', renderFloors);
store.on('floor', renderFloors);
store.on('project', renderFloors);

// ---- Workers ------------------------------------------------------------------------------------
/** What each worker was last, to tell when one starts waiting on someone. */
const lastStatus = new Map<string, string>();

function renderWorkers() {
  const list = byUrgency(store.workers.values());
  const ul = $('workers');
  ul.replaceChildren(...list.map(workerCard));
  if (!list.length) ul.append(h('li.lite-empty', {}, store.project ? 'Nobody is working on this floor. ✨ New task hires someone.' : 'No workers here.'));
  $('waiting-now').textContent = waitingLabel(waitingInOrder(list));
  renderTitle();
}

function workerCard(w: WorkerInfo): HTMLElement {
  const desk = DESK_BY_ID.get(w.deskId);
  const waiting = waitingOnSomeone(w);
  const asleep = isAsleep(w.status);
  const badge = w.kind === 'agent' ? modelBadge(w.provider, w.model, w.effort) : undefined;
  const task = w.task?.name ?? w.title ?? (w.prompt ? clip(w.prompt, 90) : undefined);
  // What it's asking, doing or did, in a line.
  const now = w.lost
    ? '🌿 Its worktree was deleted outside agent-office: open it to fix it'
    : w.status === 'needs_input'
      ? `🙋 ${w.activity ?? 'Waiting on an answer'}`
      : asleep
        ? '💤 Asleep: open it to wake it up'
        : w.status === 'done'
          ? w.task?.summary && `✅ ${w.task.summary}`
          : (w.task?.summary ?? w.activity);
  const sub = [
    w.kind === 'agent' ? `⚙️ ${providerLabel(w.provider, store.project)}${badge ? ` · ${badge}` : ''}` : '🐚 shell',
    desk && (desk.station ? `📌 ${desk.label}` : desk.label),
    w.worktree && `🌿 ${w.worktree.branch}`,
    w.pr && `🔀 PR #${w.pr.number}`,
    w.lastInput && `⌨️ ${w.lastInput.by} ${timeAgo(w.lastInput.at)}`,
  ].filter(Boolean);
  return h(
    'li.lite-worker',
    { class: `${w.status}${waiting ? ' waiting' : ''}` },
    h(
      'button.lite-card',
      { type: 'button', onclick: () => openWorker(w.id), 'aria-label': `${w.name}, ${STATUS_LABEL[w.status] ?? w.status}: open its terminal` },
      h('span.dot', { style: `background:${w.color}` }),
      h(
        'span.lite-info',
        {},
        h('span.lite-name', {}, w.name),
        task ? h('span.lite-task', {}, task) : null,
        now ? h('span.lite-now', {}, now) : null,
        h('span.lite-sub', {}, sub.join(' · ')),
      ),
      h('span.lite-state', {}, h('span.pill', { class: w.status }, STATUS_LABEL[w.status] ?? w.status), waiting && w.waitingSince ? h('small', {}, timeAgo(w.waitingSince)) : null),
    ),
    // One that's asking something is answered in its terminal, where the question is.
    asleep || w.lost || w.status === 'needs_input' ? null : h('button.btn.lite-say', { type: 'button', title: `Send ${w.name} a prompt`, 'aria-label': `Send ${w.name} a prompt`, onclick: () => promptWorker(w.id) }, '✍️'),
  );
}

/** A worker needs input or is done: a notification while you're elsewhere, and a buzz. */
function noticeWorkers() {
  for (const w of store.workers.values()) {
    const before = lastStatus.get(w.id);
    lastStatus.set(w.id, w.status);
    if (before === undefined || before === w.status || !waitingOnSomeone(w)) continue;
    notifier.alert(w);
    if (w.status === 'needs_input') navigator.vibrate?.(200);
  }
  notifier.sync(store.workers);
}

store.on('workers', () => {
  noticeWorkers();
  renderWorkers();
});
store.on('project', renderWorkers);
// "3m ago" moves on by itself.
setInterval(renderWorkers, 30_000);

/** Its terminal, with the keypad, waking it up first if it's asleep. */
function openWorker(id: string) {
  const w = store.workers.get(id);
  if (!w) return;
  if (w.lost) return fixLostWorktree(w);
  if (isAsleep(w.status)) {
    if (!w.sessionId && w.kind !== 'shell') toast(`${w.name} has no saved session — starting a fresh one`, 'warn');
    net.send({ t: 'worker.resume', workerId: id });
  }
  openTerminal(net, id, () => openChanges(net, id, () => openWorker(id)), undefined, { keypad: true });
}

/** Its worktree was deleted outside agent-office: put it back (everyone's who lost theirs), or send it home. */
function fixLostWorktree(w: WorkerInfo) {
  if (!w.lost || !w.worktree) return;
  const worktree = w.worktree;
  const others = [...store.workers.values()].filter((o) => o.lost && o.id !== w.id);
  lostWorktreeDialog({
    name: w.name,
    worktree,
    lost: w.lost,
    workspace: w.repos?.length ? worktree.path.replace(/[\\/][^\\/]*$/, '') : undefined,
    others: others.map((o) => o.name),
    openTerminal: isAsleep(w.status) ? undefined : () => openTerminal(net, w.id, () => openChanges(net, w.id, () => openWorker(w.id)), undefined, { keypad: true }),
    rebuild: (all) => {
      toast(all ? `Rebuilding ${others.length + 1} worktrees…` : `Rebuilding ${w.name}'s worktree…`);
      net.send({ t: 'worker.rebuild', workerId: w.id, all });
    },
    sendHome: () =>
      sendHomeDialog({
        workerId: w.id,
        name: w.name,
        where: DESK_BY_ID.get(w.deskId)?.label ?? 'its desk',
        worktree,
        repos: w.repos?.length ? [worktree.path.split(/[\\/]/).pop() ?? 'its own', ...w.repos.map((r) => r.name)] : undefined,
        ask: () => net.send({ t: 'worker.worktree', workerId: w.id }),
        onConfirm: (cleanup) => net.send({ t: 'worker.kill', workerId: w.id, cleanup }),
      }),
  });
}

function promptWorker(id: string) {
  const w = store.workers.get(id);
  if (!w) return;
  openPrompt({
    title: `✍️ Prompt ${w.name}`,
    subtitle: w.status === 'working' ? `${w.name} is busy, so this waits in its input box until it's done.` : undefined,
    placeholder: 'What should it do next?',
    submitLabel: 'Send',
    onSubmit: (text) => net.send({ t: 'worker.prompt', workerId: id, prompt: text }),
  });
}

// ---- New work: a prompt for a worker who's here, or a new one at a free desk -------------------
function hire(deskId: string, prompt: string, worktree: boolean, provider?: AgentProvider, model?: string, effort?: AgentEffort, repos?: string[]) {
  net.send({ t: 'worker.spawn', deskId, prompt, worktree, provider, model, effort, repos: repos?.length ? repos : undefined });
}

function sendToWorker(title: string, text: { context?: string; initial?: string } = {}) {
  if (!store.project) return toast('Pick a floor first', 'warn');
  // The back office's desks too, as far as the floor's built out (see WING).
  const desk = nextFreeSeat((id) => !!store.workerAtDesk(id), store.floorPlan.wing)?.id;
  const awake = [...store.workers.values()].filter((w) => w.kind === 'agent' && !isAsleep(w.status));
  if (!desk && !awake.length) return toast('Every desk and bean bag is taken — send a worker home first', 'warn');
  openAsk({
    title,
    ...text,
    newDesk: desk ? DESK_BY_ID.get(desk)!.label : undefined,
    workers: awake.map((w) => ({ id: w.id, name: w.name, color: w.color, status: w.status })),
    worktreeOption: !!store.project.branch,
    providerOption: true,
    repoOptions: repoChoices(),
    onSubmit: (prompt, to, worktree, provider, model, effort, repos) => {
      if (to) net.send({ t: 'worker.prompt', workerId: to, prompt });
      else if (desk) hire(desk, prompt, worktree, provider, model, effort, repos);
    },
  });
}

// ---- The boards, the queue and the meeting room -------------------------------------------------
function boardActions(): BoardActions {
  return {
    queue: (prompt, title, issue, provider, model, effort) => net.send({ t: 'queue.add', prompt, title, issue, provider, model, effort }),
    assign: (prompt, title) => sendToWorker(`🤖 ${title}`, { initial: prompt }),
    ask: (context, title) => sendToWorker(`✍️ ${title}`, { context }),
    // There's no desk to walk to from here: its terminal instead.
    goToDesk: (deskId) => {
      const w = store.workerAtDesk(deskId);
      if (!w) return;
      closeAllModals();
      openWorker(w.id);
    },
    meeting: (preset) => showMeeting(preset),
  };
}

function showMeeting(preset?: MeetingPreset) {
  openMeeting(
    net,
    {
      openTerminal: openWorker,
      openPr: (id) => {
        const w = store.workers.get(id);
        if (!w) return;
        const it = w.pr && store.pulls.items.find((p) => p.number === w.pr!.number);
        if (it) openPull(it, net, boardActions());
        else if (w.pr) window.open(w.pr.url, '_blank', 'noopener');
        else net.send({ t: 'worker.pr', workerId: id });
      },
    },
    preset,
  );
}

$('btn-issues').addEventListener('click', () => openBoard('issues', net, boardActions()));
$('btn-pulls').addEventListener('click', () => openBoard('pulls', net, boardActions()));
$('btn-queue').addEventListener('click', () => openQueue(net, { openTerminal: openWorker }));
$('btn-new').addEventListener('click', () => sendToWorker('✨ New task'));

function renderNav() {
  const count = (id: string, n: number) => ($(id).querySelector('.n')!.textContent = n ? String(n) : '');
  count('btn-issues', store.issues.items.filter((i) => i.state === 'OPEN').length);
  count('btn-pulls', store.pulls.items.filter((p) => p.state === 'OPEN').length);
  count('btn-queue', store.queue.tasks.filter((t) => t.status !== 'done').length);
}
store.on('issues', renderNav);
store.on('pulls', renderNav);
store.on('queue', renderNav);

// ---- What you have open, for the others (see PeerInfo.doing) -----------------------------------
let doingSent: string | undefined;
let readingSent = false;
function sendDoing(reconnected = false) {
  if (reconnected) {
    doingSent = undefined;
    readingSent = false;
  }
  const what = doingNow();
  const reading = readingNow();
  if (what === doingSent && reading === readingSent) return;
  doingSent = what;
  readingSent = reading;
  net.send({ t: 'doing', what, reading });
}
onModalChange(() => sendDoing());
onDoingChange(() => sendDoing());

// ---- Notifications ------------------------------------------------------------------------------
// The browser only asks from a tap, so there's a button for it while it hasn't been asked.
const bell = h('button.btn', { type: 'button', title: 'Get a notification when a worker needs input or is done', 'aria-label': 'Turn on notifications' }, '🔔');
bell.addEventListener('click', async () => {
  await askNotifyPermission();
  bell.remove();
});
if (notifyPermission() === 'default' && settings.notify) $('to-3d').before(bell);

// ---- In ----------------------------------------------------------------------------------------
/** Your name, the first time this browser comes in on the shared password. */
function askName(done: (name: string) => void) {
  const input = h('input', { type: 'text', maxlength: 24, placeholder: 'Your name', 'aria-label': 'Your name', autocomplete: 'nickname' }) as HTMLInputElement;
  const form = h(
    'form.modal.lite-name',
    {},
    h('header', {}, h('h2', {}, '👋 Who is it?')),
    h('div.body', {}, h('p', {}, 'Your teammates see this name on what you type and send.'), input),
    h('footer', {}, h('button.btn.primary', { type: 'submit' }, 'Come on in')),
  );
  const modal = openModal(form, { escCloses: false, backdropCloses: false });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return input.focus();
    modal.close();
    done(name);
  });
  setTimeout(() => input.focus(), 30);
}

void (async () => {
  try {
    const res = await fetch('/api/whoami', { cache: 'no-store' });
    if (res.status === 401) return void (location.href = '/login?next=/lite');
    const { me } = (await res.json()) as { me?: typeof store.me };
    if (me) store.me = me;
  } catch {
    // the welcome message says it too
  }
  // With an account of your own, your name is that account's.
  if (store.me.account) store.profile.name = store.me.account.name;
  if (saved || store.me.account) return net.connect();
  askName((name) => {
    store.profile.name = name;
    // No look: the 3D office still has you pick a character the first time you go in.
    saveProfile({ name, color: store.profile.color });
    net.connect();
  });
})();

renderFloors();
renderWorkers();
renderNav();

// Debug handle for quick checks from the console / headless screenshots.
(window as any).__lite = { store, net };
