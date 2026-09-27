import type { AgentProvider, Usage } from '../../shared/protocol';
import { store } from '../state';
import { $, h } from './dom';
import { providerUsageState, providerUsageTracked, resolvedProvider } from './provider';

export const tokensOf = (u: Usage) => u.totalTokens ?? (u.input + u.output + (u.reasoning ?? 0) + u.cacheWrite + u.cacheRead);

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(n < 10e6 ? 2 : 1)}M`;
}

export function fmtCost(usd: number): string {
  if (usd > 0 && usd < 0.005) return '<$0.01';
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function displayedCost(u: Usage): string {
  return u.costKnown === false ? 'cost unavailable' : fmtCost(u.cost);
}

/** e.g. "$0.42 · 38k tokens"; OpenCode's amount is explicitly an estimate. */
export function usageLabel(u: Usage, provider: AgentProvider = 'claude'): string {
  const money = provider === 'codex' && u.costKnown !== true
    ? 'cost unavailable'
    : u.costKnown === false
      ? 'cost unavailable'
      : `${fmtCost(u.cost)}${provider === 'opencode' ? ' reported' : ''}`;
  return `${u.incomplete ? "Partial: " : ""}${money} · ${fmtTokens(tokensOf(u))} tokens`;
}

/** The breakdown behind a figure, for a tooltip. */
export function usageTitle(u: Usage, provider: AgentProvider = 'claude'): string {
  const money = provider === 'codex' && u.costKnown !== true ? 'cost unavailable' : u.costKnown === false ? 'cost unavailable' : fmtCost(u.cost);
  const calls = provider === 'codex' || u.callsKnown === false
    ? 'API call count unavailable'
    : provider === 'opencode'
      ? `${u.calls} reported call${u.calls === 1 ? '' : 's'}`
      : `${u.calls} API call${u.calls === 1 ? '' : 's'}`;
  return [
    ...(u.incomplete ? ['Partial metrics: some session history is still loading or unavailable.'] : []),
    provider === 'codex'
      ? `Codex root-session metrics; subagent usage is not included; ${money}; ${calls}`
      : provider === 'opencode'
        ? `OpenCode reported estimate ${money}; model/provider estimate, not billing; ${calls}`
        : `${money} over ${calls}`,
    `input ${fmtTokens(u.input)} · output ${fmtTokens(u.output)}`,
    `reasoning ${fmtTokens(u.reasoning ?? 0)}`,
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
  let currentOpenCodeCost = 0;
  let currentOpenCodeTokens = 0;
  let currentOpenCodeInput = 0;
  let currentOpenCodeOutput = 0;
  let currentOpenCodeReasoning = 0;
  let currentOpenCodeCacheWrite = 0;
  let currentOpenCodeCacheRead = 0;
  let currentOpenCodeReports = 0;
  let currentOpenCodeCostUnknown = false;
  let currentOpenCodeIncomplete = false;
  let openCodeWaiting = false;
  let currentCodexCost = 0;
  let currentCodexTokens = 0;
  let currentCodexInput = 0;
  let currentCodexOutput = 0;
  let currentCodexReasoning = 0;
  let currentCodexCacheWrite = 0;
  let currentCodexCacheRead = 0;
  let currentCodexReports = 0;
  let currentCodexCostUnknown = false;
  let currentCodexIncomplete = false;
  let codexWaiting = false;
  let untracked = false;
  for (const w of store.workers.values()) {
    if (w.kind !== 'agent') continue;
    const provider = resolvedProvider(w.provider, store.project);
    const state = providerUsageState(provider, store.project, w.usage);
    if (state === 'untracked') untracked = true;
    if (provider === 'opencode') {
      if (!w.usage) {
        openCodeWaiting = true;
        continue;
      }
      currentOpenCodeReports++;
      if (w.usage.incomplete) currentOpenCodeIncomplete = true;
      currentOpenCodeTokens += tokensOf(w.usage);
      currentOpenCodeInput += w.usage.input;
      currentOpenCodeOutput += w.usage.output;
      currentOpenCodeReasoning += w.usage.reasoning ?? 0;
      currentOpenCodeCacheWrite += w.usage.cacheWrite;
      currentOpenCodeCacheRead += w.usage.cacheRead;
      if (w.usage.costKnown === false) currentOpenCodeCostUnknown = true;
      else currentOpenCodeCost += w.usage.cost;
    }
    if (provider === 'codex') {
      if (!w.usage) {
        codexWaiting = true;
        continue;
      }
      currentCodexReports++;
      if (w.usage.incomplete) currentCodexIncomplete = true;
      currentCodexTokens += tokensOf(w.usage);
      currentCodexInput += w.usage.input;
      currentCodexOutput += w.usage.output;
      currentCodexReasoning += w.usage.reasoning ?? 0;
      currentCodexCacheWrite += w.usage.cacheWrite;
      currentCodexCacheRead += w.usage.cacheRead;
      if (w.usage.costKnown !== true) currentCodexCostUnknown = true;
      else currentCodexCost += w.usage.cost;
    }
    if (providerUsageTracked(provider, store.project, w.usage) && w.usage?.costKnown !== false && !w.usage?.incomplete) now += w.usage?.cost ?? 0;
  }
  const head = $('workers-cost');
  head.textContent = now > 0 ? fmtCost(now) : '';
  head.title = 'Current desks: tracked Claude Code costs plus reported OpenCode estimates; Codex root-session tokens appear below; sessions with unavailable cost or partial history are excluded.';

  const el = $('usage');
  const any = s.total.calls > 0 || s.budget !== undefined || untracked || currentOpenCodeReports > 0 || openCodeWaiting || currentCodexReports > 0 || codexWaiting;
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
        h('b', { title: usageTitle(s.today, 'claude') }, displayedCost(s.today)),
        s.budget !== undefined ? h('span.muted', {}, `of ${fmtCost(s.budget)}`) : h('span.muted', {}, `· ${fmtTokens(tokensOf(s.today))} tokens`),
      ),
    );
  }
  if (s.budget !== undefined) {
    const pct = Math.min(100, (s.today.cost / s.budget) * 100);
    const state = over ? (s.pauseHiring ? 'Budget spent — no new hires until tomorrow' : 'Budget spent') : `${Math.round(pct)}% of today's budget`;
    rows.push(h('div.budget', { class: over ? 'over' : pct >= 80 ? 'near' : '', title: state, role: 'progressbar', 'aria-valuenow': Math.round(pct) }, h('div.fill', { style: `width:${pct}%` })));
  }
  if (s.total.calls > 0 || s.budget !== undefined) rows.push(h('div.row.muted', { title: usageTitle(s.total, 'claude') }, `Claude Code all time ${displayedCost(s.total)} · ${fmtTokens(tokensOf(s.total))} tokens`));
  if (currentOpenCodeReports > 0) {
    const amount = currentOpenCodeCostUnknown ? 'cost unavailable' : `${fmtCost(currentOpenCodeCost)} reported`;
    rows.push(
      h(
        'div.row.muted',
        {
          title: [
            'OpenCode current-desk metrics are model/provider estimates, not billing.',
            `input ${fmtTokens(currentOpenCodeInput)} · output ${fmtTokens(currentOpenCodeOutput)}`,
            `reasoning ${fmtTokens(currentOpenCodeReasoning)}`,
            `cache write ${fmtTokens(currentOpenCodeCacheWrite)} · cache read ${fmtTokens(currentOpenCodeCacheRead)}`,
          ].join('\n'),
        },
        `OpenCode ${currentOpenCodeIncomplete ? "partial" : "current desks"} ${amount} · ${fmtTokens(currentOpenCodeTokens)} tokens`,
      ),
    );
  }
  if (openCodeWaiting) rows.push(h('div.row.muted', { title: 'OpenCode usage appears after its first metrics report.' }, 'OpenCode metrics waiting for first report'));
  if (currentCodexReports > 0) {
    const amount = currentCodexCostUnknown ? 'cost unavailable' : fmtCost(currentCodexCost);
    rows.push(
      h(
        'div.row.muted',
        {
          title: [
            'Codex current-desk metrics cover the root session only; subagent usage is not included; cost is unavailable.',
            `input ${fmtTokens(currentCodexInput)} · output ${fmtTokens(currentCodexOutput)}`,
            `reasoning ${fmtTokens(currentCodexReasoning)}`,
            `cache write ${fmtTokens(currentCodexCacheWrite)} · cache read ${fmtTokens(currentCodexCacheRead)}`,
          ].join('\n'),
        },
        `Codex ${currentCodexIncomplete ? 'partial' : 'current desks'} ${amount} · ${fmtTokens(currentCodexTokens)} tokens`,
      ),
    );
  }
  if (codexWaiting) rows.push(h('div.row.muted', { title: 'Codex usage appears after its first root-session metrics report; subagent usage is not included.' }, 'Codex metrics waiting for first report'));
  if (untracked) {
    rows.push(h('div.row.muted', { title: 'Custom provider usage is not reported by the office.' }, 'Custom usage untracked · budget and totals cover Claude Code only'));
  }
  el.replaceChildren(...rows);
}
