import './lobby.css';
import { councilAccess } from '../../shared/access';
import { store } from '../state';
import { h, openModal } from './dom';

interface BriefInput {
  workers: { status: string }[];
  queue: { status: string }[];
  alerts: { severity: string }[];
  issues: { state: string }[];
  pulls: { state: string }[];
  council: { status: string } | null;
}

type IntegrationState = 'LIVE' | 'CONFIGURED' | 'OFFLINE' | 'PLANNED';

interface IntegrationInput {
  floor: string | null;
  project: { agentProviders: string[] } | null;
  workers: { provider?: string; model?: string; status: string }[];
  /** The floor's alert board: the research feed's own cards are the evidence it is wired. */
  alerts?: { kind: string }[];
}

/** Runtime truth only: configured adapters are not reported as live workers. */
export function integrationStatus(input: IntegrationInput): Record<'server' | 'research' | 'qwen' | 'muse' | 'remotion', IntegrationState> {
  const configured = new Set(input.project?.agentProviders ?? []);
  const active = input.workers.filter((w) => w.status !== 'done' && w.status !== 'exited');
  const qwenLive = active.some((w) => w.provider === 'hermes' && /qwen3\.5/i.test(w.model ?? ''));
  const museLive = active.some((w) => w.provider === 'muse');
  // Research is live only when its own cards reached the board — the report produced them.
  const researchLive = (input.alerts ?? []).some((card) => card.kind === 'insider');
  return {
    server: input.floor && input.project ? 'LIVE' : 'OFFLINE',
    research: researchLive ? 'LIVE' : 'OFFLINE',
    qwen: qwenLive ? 'LIVE' : configured.has('hermes') ? 'CONFIGURED' : 'OFFLINE',
    muse: museLive ? 'LIVE' : configured.has('muse') ? 'CONFIGURED' : 'OFFLINE',
    remotion: 'PLANNED',
  };
}

export function dailyBrief(input: BriefInput) {
  return {
    activeWorkers: input.workers.filter((w) => w.status !== 'done' && w.status !== 'exited').length,
    waitingWorkers: input.workers.filter((w) => w.status === 'needs_input').length,
    openTasks: input.queue.filter((task) => task.status !== 'done').length,
    alerts: input.alerts.length,
    urgentAlerts: input.alerts.filter((alert) => alert.severity === 'urgent').length,
    openIssues: input.issues.filter((issue) => issue.state === 'OPEN').length,
    openPulls: input.pulls.filter((pull) => pull.state === 'OPEN').length,
    councilActive: input.council?.status === 'running',
  };
}

export interface LobbyActions {
  council(): void;
  canvas(): void;
  alerts(): void;
}

export function openLobby(actions: LobbyActions) {
  const access = councilAccess(store.me);
  const stats = h('div.lobby-stats');
  const activity = h('div.lobby-activity');
  const integrations = h('div.lobby-integrations');
  const card = (icon: string, value: number | string, label: string, tone = '') => h('div.lobby-stat', { class: tone }, h('span', {}, icon), h('b', {}, String(value)), h('small', {}, label));
  const action = (icon: string, title: string, copy: string, run: () => void) => h('button.lobby-action', { type: 'button', onclick: run }, h('span', {}, icon), h('div', {}, h('b', {}, title), h('small', {}, copy)));
  const el = h('div.modal.lobby-modal', { role: 'dialog', 'aria-label': 'Dewa Information Alpha lobby' },
    h('header.lobby-hero', {}, h('div', {}, h('p.lobby-kicker', {}, 'LOKIDEWA COUNCIL'), h('h2', {}, 'Dewa Information Alpha'), h('p', {}, 'Research, challenge evidence, decide, execute.')), h('div.lobby-identity', {}, h('span.lobby-role', {}, access.role))),
    h('div.body.lobby-body', {}, h('section', {}, h('h3', {}, 'Today’s brief'), stats, activity, h('h3', {}, 'Integrations'), integrations), h('section.lobby-actions', {}, action('🏛️', 'Council war room', 'Call or observe a decision session', actions.council), action('🧠', 'Research canvas', 'Map narratives, evidence, and hypotheses', actions.canvas), action('📡', 'Alpha alerts', 'Review WHY NOW cards and invalidation', actions.alerts), action('📱', 'Mobile companion', 'Open fast 2D operations view', () => location.assign('/lite')))),
  );
  let modal: ReturnType<typeof openModal>;
  for (const button of el.querySelectorAll<HTMLButtonElement>('.lobby-action')) {
    const old = button.onclick;
    button.onclick = (event) => { modal.close(); old?.call(button, event); };
  }
  const render = () => {
    const brief = dailyBrief({ workers: [...store.workers.values()], queue: store.queue.tasks, alerts: store.alerts.cards, issues: store.issues.items, pulls: store.pulls.items, council: store.meeting.current });
    stats.replaceChildren(card('🤖', brief.activeWorkers, 'active agents'), card('🙋', brief.waitingWorkers, 'need you', brief.waitingWorkers ? 'warn' : ''), card('📋', brief.openTasks, 'open tasks'), card('📡', brief.alerts, 'signals', brief.urgentAlerts ? 'urgent' : ''), card('📌', brief.openIssues, 'open issues'), card('🔀', brief.openPulls, 'open PRs'));
    activity.replaceChildren(h('span.lobby-status', { class: brief.councilActive ? 'on' : '' }, brief.councilActive ? '🏛️ Council session active' : '🏛️ Council room ready'), brief.urgentAlerts ? h('span.lobby-status.urgent', {}, `${brief.urgentAlerts} urgent signal${brief.urgentAlerts === 1 ? '' : 's'}`) : h('span.lobby-status', {}, 'No urgent signals'));
    const connected = integrationStatus({ floor: store.floor, project: store.project, workers: [...store.workers.values()], alerts: store.alerts.cards });
    integrations.replaceChildren(...Object.entries(connected).map(([name, state]) => h('span.lobby-status', { class: state === 'LIVE' ? 'on' : state === 'OFFLINE' ? 'warn' : '' }, `${name}: ${state}`)));
  };
  render();
  const offs = ['workers', 'queue', 'alerts', 'issues', 'pulls', 'meeting'].map((topic) => store.on(topic as never, render));
  modal = openModal(el, { doing: 'reviewing today’s Dewa Alpha brief', reading: true, onClose: () => offs.forEach((off) => off()) });
  return modal;
}
