import type { Usage } from '../../shared/protocol';
import { store } from '../state';
import { $, h } from './dom';
import { providerUsageTracked } from './provider';

export const tokensOf = (u: Usage) => u.input + u.output + u.cacheWrite + u.cacheRead;

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(n < 10e6 ? 2 : 1)}M`;
}

export function fmtCost(usd: number): string {
  if (usd > 0 && usd < 0.005) return '<$0.01';
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** e.g. "$0.42 · 38k tokens" */
export const usageLabel = (u: Usage) => `${fmtCost(u.cost)} · ${fmtTokens(tokensOf(u))} tokens`;

/** The breakdown behind a figure, for a tooltip. */
export function usageTitle(u: Usage): string {
  return [
    `${fmtCost(u.cost)} over ${u.calls} API call${u.calls === 1 ? '' : 's'}`,
    `input ${fmtTokens(u.input)} · output ${fmtTokens(u.output)}`,
    `cache write ${fmtTokens(u.cacheWrite)} · cache read ${fmtTokens(u.cacheRead)}`,
  ].join('\n');
}

export function overBudget(): boolean {
  const s = store.usage;
  return s.budget !== undefined && s.today.cost >= s.budget;
}

/** New hires are refused: the daily budget is spent and the office runs with --budget-pause. */
export const hiringPaused = () => store.usage.pauseHiring && overBudget();

/** The sidebar's spend lines: what the workers at their desks cost, today's total and the budget. */
export function renderUsage() {
  const s = store.usage;
  let now = 0;
  for (const w of store.workers.values()) if (w.kind === 'agent' && providerUsageTracked(w.provider, store.project, w.usage)) now += w.usage?.cost ?? 0;
  const untracked = [...store.workers.values()].some((w) => w.kind === 'agent' && !providerUsageTracked(w.provider, store.project, w.usage));
  const head = $('workers-cost');
  head.textContent = now > 0 ? fmtCost(now) : '';
  head.title = 'Tracked Claude Code spend at occupied desks';

  const el = $('usage');
  const any = s.total.calls > 0 || s.budget !== undefined || untracked;
  el.classList.toggle('hidden', !any);
  if (!any) return;
  const over = overBudget();
  el.classList.toggle('over', over);
  const rows: HTMLElement[] = [];
  if (s.total.calls > 0 || s.budget !== undefined) {
    rows.push(
      h(
        'div.row',
        {},
        h('span', {}, '💸 Claude Code today'),
        h('b', { title: usageTitle(s.today) }, fmtCost(s.today.cost)),
        s.budget !== undefined ? h('span.muted', {}, `of ${fmtCost(s.budget)}`) : h('span.muted', {}, `· ${fmtTokens(tokensOf(s.today))} tokens`),
      ),
    );
  }
  if (s.budget !== undefined) {
    const pct = Math.min(100, (s.today.cost / s.budget) * 100);
    const state = over ? (s.pauseHiring ? 'Budget spent — no new hires until tomorrow' : 'Budget spent') : `${Math.round(pct)}% of today's budget`;
    rows.push(h('div.budget', { class: over ? 'over' : pct >= 80 ? 'near' : '', title: state, role: 'progressbar', 'aria-valuenow': Math.round(pct) }, h('div.fill', { style: `width:${pct}%` })));
  }
  if (s.total.calls > 0 || s.budget !== undefined) rows.push(h('div.row.muted', { title: usageTitle(s.total) }, `Claude Code all time ${fmtCost(s.total.cost)} · ${fmtTokens(tokensOf(s.total))} tokens`));
  if (untracked) {
    rows.push(h('div.row.muted', { title: 'OpenCode and custom provider usage is not reported by the office.' }, 'OpenCode/custom usage untracked · budget and totals cover Claude Code only'));
  }
  el.replaceChildren(...rows);
}
