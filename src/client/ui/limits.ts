import type { PlanWindow } from '../../shared/protocol';
import { store } from '../state';
import { $, h } from './dom';
import { panelHide } from './menu';

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

function quotaClock(w: PlanWindow): HTMLElement {
  const pct = Math.round(w.pct);
  const title = `${w.label} Codex allowance: ${pct}% used${w.resetsAt ? `\nResets ${new Date(w.resetsAt).toLocaleString()}` : ''}`;
  return h(
    'div.codex-clock-row',
    { title },
    h('div.quota-dial', { class: level(w.pct), style: `--quota:${w.pct}%`, role: 'progressbar', 'aria-label': `${w.label} Codex usage`, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct }, h('span', {}, `${pct}%`)),
    h('div.quota-copy', {}, h('b', {}, w.label), h('span', {}, 'used'), w.resetsAt ? h('small', {}, `resets ${fmtReset(w.resetsAt, Date.now())}`) : null),
  );
}

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

/** The Claude plan's 5-hour session and weekly limits, under the workers. Click to read them again. */
export function renderLimits() {
  const s = store.limits;
  const el = $('limits');
  el.classList.toggle('hidden', !s.windows.length);
  if (!s.windows.length) return;
  const now = Date.now();
  const plan = s.plan ? s.plan.charAt(0).toUpperCase() + s.plan.slice(1) : '';
  el.replaceChildren(h('h3', {}, 'Claude limits', plan ? h('span.plan', {}, plan) : null, panelHide('limits')), ...s.windows.flatMap((w) => windowRow(w, now)));
  if (now - s.at > STALE_MS) el.append(h('div.row.muted', {}, `As of ${new Date(s.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`));
}

/** Codex account plan usage from its signed-in app server, shown as compact percentage clocks. */
export function renderCodexLimits() {
  const state = store.codexLimits;
  const el = $('codex-limits');
  el.classList.remove('hidden');
  const now = Date.now();
  const plan = state.plan ? state.plan.charAt(0).toUpperCase() + state.plan.slice(1) : '';
  const parts: (HTMLElement | null)[] = [h('h3', {}, 'Codex usage', plan ? h('span.plan', {}, plan) : null, panelHide('codexLimits')), h('div.row.muted', {}, 'Office host account')];
  if (state.windows.length) {
    parts.push(...state.windows.map(quotaClock));
    if (state.status === 'unavailable') parts.push(h('div.row.muted', {}, state.message ?? 'Usage refresh unavailable'));
    const lastRead = state.at || state.checkedAt;
    if (lastRead && (now - lastRead > STALE_MS || state.status === 'unavailable')) {
      parts.push(h('div.row.muted', {}, `Last read ${new Date(lastRead).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`));
    }
  } else {
    parts.push(h('div.row.muted', {}, state.status === 'checking' ? 'Checking the signed-in Codex account…' : state.message ?? 'Codex usage is unavailable'));
  }
  el.replaceChildren(...parts.filter((part): part is HTMLElement => part !== null));
}
