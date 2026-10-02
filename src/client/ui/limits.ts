import type { PlanWindow } from '../../shared/protocol';
import { store } from '../state';
import { $, h } from './dom';
import { panelHide } from './menu';
import { L } from '../i18n';

/** Numbers older than this say when they were read. */
const STALE_MS = 10 * 60_000;

/** "in 12m", "in 2h 5m", or "Tue 5:00 AM" once it is more than a day out. */
export function fmtReset(at: number, now = Date.now()): string {
  const mins = Math.ceil((at - now) / 60_000);
  if (mins <= 0) return L.limits.now;
  if (mins < 60) return L.limits.in(`${mins}m`);
  if (mins < 24 * 60) return L.limits.in(`${Math.floor(mins / 60)}h ${mins % 60}m`);
  return new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** A plan window's name, which the server gives in English (see server/limits.ts). */
const windowLabel = (label: string) => L.limits.windows[label] ?? label;

const level = (pct: number) => (pct >= 90 ? 'over' : pct >= 75 ? 'near' : '');

function windowRow(w: PlanWindow, now: number): HTMLElement[] {
  const pct = Math.round(w.pct);
  const when = w.resetsAt ? new Date(w.resetsAt).toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : '';
  const scope = w.label === 'Week' ? ` ${L.limits.allModels}` : '';
  const title = `${windowLabel(w.label)}${scope}: ${L.limits.used(pct)}${when ? `\n${L.limits.startsOver(when)}` : ''}`;
  return [
    h(
      'div.row',
      { title },
      h('span.what', {}, w.label),
      h('b', { class: level(w.pct) }, `${pct}%`),
      w.resetsAt ? h('span.reset', {}, L.limits.resets(fmtReset(w.resetsAt, now))) : null,
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
  el.replaceChildren(h('h3', {}, L.menu.panels.limits.label, plan ? h('span.plan', {}, plan) : null, panelHide('limits')), ...s.windows.flatMap((w) => windowRow(w, now)));
  if (now - s.at > STALE_MS) el.append(h('div.row.muted', {}, L.limits.asOf(new Date(s.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))));
}
