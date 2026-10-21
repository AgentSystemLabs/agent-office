// ⚙️ Settings' Board agents, under Workers: what the Issues and PR agents start on when nobody
// picks for them there. An admin can give each one a provider, model and effort of its own; left
// alone, they run on the office's Default worker (see server/stations.ts). The Queue agent is never
// picked for here: it always runs on the default.
import type { Net } from '../net';
import { store } from '../state';
import type { AgentChoice } from '../../shared/protocol';
import { STATION_AGENT, type ConfigurableStation } from '../../shared/layout.js';
import { h } from './dom';
import { agentFields, choiceLabel, officeChoice } from './provider.js';

/** The boards an admin picks a worker for, in the order they stand here. */
export const BOARD_AGENTS: readonly ConfigurableStation[] = ['issues', 'pulls'] as const;

/** One board agent's row: what it starts on, and the fields to pick another for it. */
export interface BoardAgentRow {
  /** What it starts on: the station's own pick, or the office's default worker. */
  now: HTMLElement;
  fields: HTMLElement;
  /** Save, and ↺ Use the default. */
  actions: HTMLElement;
  /** Repaints it from the store; called again whenever ⚙️ Settings changes. */
  paint: () => void;
}

/**
 * A board agent's provider, model and effort, in ⚙️ Settings → 🤖 Workers. It reads what the station
 * starts on — its own pick, else the office's default — and offers ✏️ Edit to pick another, Save to
 * send it, and ↺ Use the default to drop it. Only admins get the buttons; for everyone else it's a
 * line saying what that agent runs on.
 */
export function boardAgentRow(net: Net, kind: ConfigurableStation): BoardAgentRow {
  const name = STATION_AGENT[kind].name;
  const id = `station-${kind}`;
  const fields = agentFields(store.project, id, stationChoice(kind));
  let editing = false;
  /** What the fields were opened on: ✏️ Edit with nothing changed sends nothing. */
  let opened: AgentChoice | undefined;
  const now = h('p.outside-now');
  const edit = h('button.btn', { type: 'button', 'aria-expanded': 'false' });
  const save = h('button.btn.primary', { type: 'button' }, 'Save');
  const back = h('button.btn', { type: 'button' }, '↺ Use the default');
  const actions = h('div.seg', { style: 'margin-top:8px' }, edit, save, back);

  /** The station's own pick, when an admin made one this project can still run. */
  const own = () => store.prompts.stations?.[kind] as (AgentChoice & { by: string; at: number }) | undefined;

  edit.addEventListener('click', () => {
    editing = !editing;
    opened = editing ? stationChoice(kind) : undefined;
    // It opens on what the agent runs on now, and closing without saving goes back to it.
    if (editing) fields.set(stationChoice(kind));
    paint();
    if (editing) (fields.element.querySelector('select') as HTMLSelectElement | null)?.focus();
  });
  save.addEventListener('click', () => {
    if (!fields.valid()) return;
    const choice = fields.choice();
    // Nothing changed: saving would only restamp who set it.
    if (opened && sameChoice(opened, choice)) {
      editing = false;
      paint();
      return;
    }
    net.send({ t: 'prompts.station', kind, choice });
    editing = false;
    paint();
  });
  back.addEventListener('click', () => {
    net.send({ t: 'prompts.station', kind, choice: null });
    editing = false;
    paint();
  });

  function paint(): void {
    const admin = store.me.admin;
    const mine = own();
    const choice = stationChoice(kind);
    fields.element.classList.toggle('hidden', !admin || !editing);
    actions.classList.toggle('hidden', !admin);
    edit.textContent = editing ? '↺ Cancel' : '✏️ Edit';
    edit.title = editing ? `Leave the ${name.toLowerCase()} on ${choiceLabel(stationChoice(kind))}` : `Pick a provider, model or effort for the ${name.toLowerCase()}`;
    edit.setAttribute('aria-expanded', String(editing));
    save.classList.toggle('hidden', !editing);
    // ↺ Use the default only means something while there's a pick to drop, and not while picking.
    back.classList.toggle('hidden', editing || !mine);
    now.classList.toggle('hidden', editing);
    now.textContent = choiceLabel(choice);
    now.title = mine
      ? `The ${name}'s own worker, set by ${mine.by}: it starts on this instead of the office's default`
      : `The office's default worker; an admin can give the ${name.toLowerCase()} one of its own in ⚙️ Settings`;
    fields.element.setAttribute('aria-label', `${name} worker`);
  }
  paint();
  // The default or a pick can change while this is open; it goes once ⚙️ Settings has closed.
  const off = store.on('prompts', () => (now.isConnected ? paint() : off()));
  return { now, fields: fields.element, actions, paint };
}

/** What a board agent starts on: its own pick, or the office's default worker. */
export function stationChoice(kind: ConfigurableStation): AgentChoice {
  const mine = store.prompts.stations?.[kind];
  if (mine) return { provider: mine.provider, ...(mine.model ? { model: mine.model } : {}), ...(mine.effort ? { effort: mine.effort } : {}) };
  return officeChoice(store.project);
}

/** Whether two picks would start a worker the same way. */
function sameChoice(a: AgentChoice, b: AgentChoice): boolean {
  return a.provider === b.provider && (a.model ?? '') === (b.model ?? '') && (a.effort ?? '') === (b.effort ?? '');
}
