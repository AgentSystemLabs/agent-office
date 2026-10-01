import type { PlanWindow } from '../../shared/protocol';
import { store } from '../state';
import { $, h } from './dom';
import { panelHide } from './menu';
import { resolvedProvider } from './provider';

/** Numbers older than this say when they were read. */
const STALE_MS = 10 * 60_000;

/** "in 12m", "in 2h 5m", or "Tue 5:00 AM" once it is more than a day out. */
export function fmtReset(at: number, now = Date.now()): string {
  const mins = Math.ceil((at - now) / 60_000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${mins}m`;
  if (mins < 24 * 60) return `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
  return new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

const level = (pct: number) => (pct >= 90 ? 'over' : pct >= 75 ? 'near' : '');

function windowRow(w: PlanWindow, now: number): HTMLElement[] {
  const pct = Math.round(w.pct);
  const when = w.resetsAt ? new Date(w.resetsAt).toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : '';
  const scope = w.label === 'Week' ? ' (all models)' : '';
  const title = `${w.label}${scope}: ${pct}% used${when ? `\nStarts over ${when}` : ''}`;
  return [
    h(
      'div.row',
      { title },
      h('span.what', {}, w.label),
      h('b', { class: level(w.pct) }, `${pct}%`),
      w.resetsAt ? h('span.reset', {}, `resets ${fmtReset(w.resetsAt, now)}`) : null,
    ),
    h('div.meter', { class: level(w.pct), title, role: 'progressbar', 'aria-label': w.label, 'aria-valuenow': pct }, h('div.fill', { style: `width:${w.pct}%` })),
  ];
}

/** Account plan meters. Codex snapshots stay separate because workers may use different accounts. */
export function renderLimits() {
  const s = store.limits;
  const codex = [...store.workers.values()].filter(w => w.kind === 'agent' && resolvedProvider(w.provider, store.project) === 'codex');
  const el = $('limits');
  el.classList.toggle('hidden', !s.windows.length && !codex.length);
  if (!s.windows.length && !codex.length) return;
  const now = Date.now();
  const rows: HTMLElement[] = [h('h3', {}, 'Limits', panelHide('limits'))];
  const append = (label: string, limits: typeof s) => {
    rows.push(h('div.row', {}, label, limits.plan ? h('span.plan', {}, limits.plan) : null));
    rows.push(...limits.windows.flatMap(w => windowRow(w, now)));
    if (now - limits.at > STALE_MS) rows.push(h('div.row.muted', {}, `As of ${new Date(limits.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`));
  };
  if (s.windows.length) append('Claude', s);
  for (const worker of codex) {
    const limits = worker.usage?.planLimits;
    const label = `Codex · ${worker.name}`;
    if (limits?.windows.length) append(label, limits);
    else rows.push(h('div.row.muted', {}, `${label}: limits unavailable`));
  }
  el.title = 'Click to refresh Claude limits. Codex limits update when each worker reports usage; workers may use different accounts.';
  el.replaceChildren(...rows);
}
