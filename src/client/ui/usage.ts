import { fmtCost, fmtTokens, tokensOf, type AgentProvider, type Usage } from '../../shared/protocol';
import { store } from '../state';
import { $, h } from './dom';
import { providerUsageState, providerUsageTracked, resolvedProvider } from './provider';
import { L } from '../i18n';

export { fmtCost, fmtTokens, tokensOf };

function displayedCost(u: Usage): string {
  return u.costKnown === false ? L.usage.noCost : fmtCost(u.cost);
}

/** e.g. "$0.42 · 38k tokens"; OpenCode's amount is explicitly an estimate. */
export function usageLabel(u: Usage, provider: AgentProvider = 'claude'): string {
  const money = provider === 'codex' && u.costKnown !== true
    ? L.usage.noCost
    : u.costKnown === false
      ? L.usage.noCost
      : `${fmtCost(u.cost)}${provider === 'opencode' ? ` ${L.usage.reported}` : ''}`;
  // DeepSeek Harness reports what is in the context window, not a token split.
  if (provider === 'dsh') {
    const window = u.contextSize !== undefined ? ` / ${fmtTokens(u.contextSize)}` : '';
    const spend = u.costKnown === true ? `${fmtCost(u.cost)} · ` : '';
    return `${u.incomplete ? L.usage.partialPrefix : ''}${spend}${fmtTokens(tokensOf(u))}${window} ${L.usage.context}`;
  }
  return `${u.incomplete ? L.usage.partialPrefix : ""}${money} · ${fmtTokens(tokensOf(u))} tokens`;
}

/** Input, output, reasoning and cache tokens, a line each, for a tooltip. */
function breakdown(input: number, output: number, reasoning: number, cacheWrite: number, cacheRead: number): string[] {
  return [L.usage.inOut(fmtTokens(input), fmtTokens(output)), L.usage.reasoning(fmtTokens(reasoning)), L.usage.cache(fmtTokens(cacheWrite), fmtTokens(cacheRead))];
}

/** The breakdown behind a figure, for a tooltip. */
export function usageTitle(u: Usage, provider: AgentProvider = 'claude'): string {
  const money = provider === 'codex' && u.costKnown !== true ? L.usage.noCost : u.costKnown === false ? L.usage.noCost : fmtCost(u.cost);
  const calls = provider === 'codex' || u.callsKnown === false
    ? L.usage.noCalls
    : provider === 'opencode'
      ? L.usage.reportedCalls(u.calls)
      : L.usage.apiCalls(u.calls);
  const dshContext = L.usage.contextTokens(fmtTokens(tokensOf(u)), u.contextSize !== undefined ? fmtTokens(u.contextSize) : undefined);
  return [
    ...(u.incomplete ? [L.usage.partial] : []),
    provider === 'codex'
      ? L.usage.codexTitle(money, calls)
      : provider === 'opencode'
        ? L.usage.openCodeTitle(money, calls)
        : provider === 'dsh'
          ? L.usage.dshTitle(dshContext, u.costKnown === true ? money : undefined, calls)
          : L.usage.over(money, calls),
    ...breakdown(u.input, u.output, u.reasoning ?? 0, u.cacheWrite, u.cacheRead),
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
  let currentDshTokens = 0;
  let currentDshContext = 0;
  let currentDshReports = 0;
  let currentDshCost = 0;
  let currentDshCostKnown = false;
  let dshWaiting = false;
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
    if (provider === 'dsh') {
      if (!w.usage) {
        dshWaiting = true;
        continue;
      }
      currentDshReports++;
      currentDshTokens += tokensOf(w.usage);
      if (w.usage.contextSize !== undefined) currentDshContext = Math.max(currentDshContext, w.usage.contextSize);
      if (w.usage.costKnown === true) {
        currentDshCost += w.usage.cost;
        currentDshCostKnown = true;
      }
    }
    if (providerUsageTracked(provider, store.project, w.usage) && w.usage?.costKnown !== false && !w.usage?.incomplete) now += w.usage?.cost ?? 0;
  }
  const head = $('workers-cost');
  head.textContent = now > 0 ? fmtCost(now) : '';
  head.title = 'Current desks: tracked Claude Code costs plus reported OpenCode and DeepSeek Harness estimates; Codex root-session tokens appear below; sessions with unavailable cost or partial history are excluded.';

  const el = $('usage');
  const any = s.total.calls > 0 || s.budget !== undefined || untracked || currentOpenCodeReports > 0 || openCodeWaiting || currentCodexReports > 0 || codexWaiting || currentDshReports > 0 || dshWaiting;
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
        h('span', {}, L.usage.today),
        h('b', { title: usageTitle(s.today, 'claude') }, displayedCost(s.today)),
        s.budget !== undefined ? h('span.muted', {}, L.usage.of(fmtCost(s.budget))) : h('span.muted', {}, `· ${fmtTokens(tokensOf(s.today))} ${L.usage.tokens}`),
      ),
    );
  }
  if (s.budget !== undefined) {
    const pct = Math.min(100, (s.today.cost / s.budget) * 100);
    const state = over ? (s.pauseHiring ? L.usage.spentPaused : L.usage.spent) : L.usage.pctToday(Math.round(pct));
    rows.push(h('div.budget', { class: over ? 'over' : pct >= 80 ? 'near' : '', title: state, role: 'progressbar', 'aria-valuenow': Math.round(pct) }, h('div.fill', { style: `width:${pct}%` })));
  }
  if (s.total.calls > 0 || s.budget !== undefined) rows.push(h('div.row.muted', { title: usageTitle(s.total, 'claude') }, L.usage.allTime(displayedCost(s.total), fmtTokens(tokensOf(s.total)))));
  if (currentOpenCodeReports > 0) {
    const amount = currentOpenCodeCostUnknown ? L.usage.noCost : `${fmtCost(currentOpenCodeCost)} ${L.usage.reported}`;
    rows.push(
      h(
        'div.row.muted',
        {
          title: [
            L.usage.openCodeDesks,
            ...breakdown(currentOpenCodeInput, currentOpenCodeOutput, currentOpenCodeReasoning, currentOpenCodeCacheWrite, currentOpenCodeCacheRead),
          ].join('\n'),
        },
        `OpenCode ${currentOpenCodeIncomplete ? L.usage.partialWord : L.usage.currentDesks} ${amount} · ${fmtTokens(currentOpenCodeTokens)} ${L.usage.tokens}`,
      ),
    );
  }
  if (openCodeWaiting) rows.push(h('div.row.muted', { title: L.usage.openCodeWaitTip }, L.usage.openCodeWait));
  if (currentCodexReports > 0) {
    const amount = currentCodexCostUnknown ? L.usage.noCost : fmtCost(currentCodexCost);
    rows.push(
      h(
        'div.row.muted',
        {
          title: [
            L.usage.codexDesks,
            ...breakdown(currentCodexInput, currentCodexOutput, currentCodexReasoning, currentCodexCacheWrite, currentCodexCacheRead),
          ].join('\n'),
        },
        `Codex ${currentCodexIncomplete ? L.usage.partialWord : L.usage.currentDesks} ${amount} · ${fmtTokens(currentCodexTokens)} ${L.usage.tokens}`,
      ),
    );
  }
  if (codexWaiting) rows.push(h('div.row.muted', { title: L.usage.codexWaitTip }, L.usage.codexWait));
  if (currentDshReports > 0) {
    const context = currentDshContext > 0 ? ` / ${fmtTokens(currentDshContext)}` : '';
    const spend = currentDshCostKnown ? `${fmtCost(currentDshCost)} · ` : '';
    rows.push(
      h(
        'div.row.muted',
        {
          title: [
            L.usage.dshDesksTip,
            L.usage.dshWorkers(currentDshReports, `${fmtTokens(currentDshTokens)}${context}`),
          ].join('\n'),
        },
        L.usage.dshDesks(`${spend}${fmtTokens(currentDshTokens)}${context}`),
      ),
    );
  }
  if (dshWaiting) rows.push(h('div.row.muted', { title: L.usage.dshWaitTip }, L.usage.dshWait));
  if (untracked) {
    rows.push(h('div.row.muted', { title: L.usage.customTip }, L.usage.custom));
  }
  el.replaceChildren(...rows);
}
