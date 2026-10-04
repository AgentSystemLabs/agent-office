import { fmtCost, fmtTokens, tokensOf, type AgentProvider, type Usage } from '../../shared/protocol';
import { store } from '../state';
import { $, h } from './dom';
import { providerUsageState, providerUsageTracked, resolvedProvider } from './provider';

export { fmtCost, fmtTokens, tokensOf };

function displayedCost(u: Usage): string {
  return u.costKnown === false ? "비용 정보 없음" : fmtCost(u.cost);
}

/** e.g. "$0.42 · 38k tokens"; OpenCode's amount is explicitly an estimate. */
export function usageLabel(u: Usage, provider: AgentProvider = 'claude'): string {
  const money = provider === 'codex' && u.costKnown !== true
    ? "비용 정보 없음"
    : u.costKnown === false
      ? "비용 정보 없음"
      : `${fmtCost(u.cost)}${provider === 'opencode' ? " (보고된 추정치)" : ''}`;
  // DeepSeek Harness reports what is in the context window, not a token split.
  if (provider === 'dsh') {
    const window = u.contextSize !== undefined ? ` / ${fmtTokens(u.contextSize)}` : '';
    const spend = u.costKnown === true ? `${fmtCost(u.cost)} · ` : '';
    return `${u.incomplete ? 'Partial: ' : ''}${spend}${fmtTokens(tokensOf(u))}${window} 컨텍스트`;
  }
  return `${u.incomplete ? "Partial: " : ""}${money} · ${fmtTokens(tokensOf(u))} 토큰`;
}

/** The breakdown behind a figure, for a tooltip. */
export function usageTitle(u: Usage, provider: AgentProvider = 'claude'): string {
  const money = provider === 'codex' && u.costKnown !== true ? "비용 정보 없음" : u.costKnown === false ? "비용 정보 없음" : fmtCost(u.cost);
  const calls = provider === 'codex' || u.callsKnown === false
    ? "API 호출 수 정보 없음"
    : provider === 'opencode'
      ? `보고된 호출 ${u.calls}회`
      : `API 호출 ${u.calls}회`;
  const dshContext = u.contextSize !== undefined ? `컨텍스트 토큰 ${fmtTokens(tokensOf(u))}/${fmtTokens(u.contextSize)}` : `컨텍스트 토큰 ${fmtTokens(tokensOf(u))}`;
  return [
    ...(u.incomplete ? ["일부 집계입니다. 세션 기록 중 일부를 불러오는 중이거나 확인할 수 없습니다."] : []),
    provider === 'codex'
      ? `Codex 주 세션의 사용량 (하위 에이전트 제외) · ${money} · ${calls}`
      : provider === 'opencode'
        ? `OpenCode 보고 추정치 ${money} · 실제 청구액과 다를 수 있음 · ${calls}`
        : provider === 'dsh'
          ? `DeepSeek Harness ACP 컨텍스트 사용량: ${dshContext} · 세션 비용 ${u.costKnown === true ? money : 'unavailable'} · ${calls}`
          : `${money} · ${calls}`,
    `입력 ${fmtTokens(u.input)} · 출력 ${fmtTokens(u.output)}`,
    `추론 ${fmtTokens(u.reasoning ?? 0)}`,
    `캐시 쓰기 ${fmtTokens(u.cacheWrite)} · 캐시 읽기 ${fmtTokens(u.cacheRead)}`,
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
  head.title = "현재 직원들의 Claude Code 비용과 OpenCode·DeepSeek Harness의 보고 추정치입니다. Codex 주 세션의 토큰은 아래에 표시합니다. 비용을 알 수 없거나 기록이 불완전한 세션은 합계에서 제외합니다.";

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
        h('span', {}, "💸 오늘의 Claude Code 사용량"),
        h('b', { title: usageTitle(s.today, 'claude') }, displayedCost(s.today)),
        s.budget !== undefined ? h('span.muted', {}, `예산 ${fmtCost(s.budget)}`) : h('span.muted', {}, `· ${fmtTokens(tokensOf(s.today))} 토큰`),
      ),
    );
  }
  if (s.budget !== undefined) {
    const pct = Math.min(100, (s.today.cost / s.budget) * 100);
    const state = over ? (s.pauseHiring ? "오늘 예산을 모두 사용했습니다. 내일부터 다시 고용할 수 있습니다" : "오늘 예산 소진") : `오늘 예산의 ${Math.round(pct)}% 사용`;
    rows.push(h('div.budget', { class: over ? 'over' : pct >= 80 ? 'near' : '', title: state, role: 'progressbar', 'aria-valuenow': Math.round(pct) }, h('div.fill', { style: `width:${pct}%` })));
  }
  if (s.total.calls > 0 || s.budget !== undefined) rows.push(h('div.row.muted', { title: usageTitle(s.total, 'claude') }, `Claude Code 누적 ${displayedCost(s.total)} · ${fmtTokens(tokensOf(s.total))} 토큰`));
  if (currentOpenCodeReports > 0) {
    const amount = currentOpenCodeCostUnknown ? "비용 정보 없음" : `${fmtCost(currentOpenCodeCost)} (보고된 추정치)`;
    rows.push(
      h(
        'div.row.muted',
        {
          title: [
            "OpenCode 사용량은 모델·서비스의 추정치이며 실제 청구액과 다를 수 있습니다.",
            `입력 ${fmtTokens(currentOpenCodeInput)} · 출력 ${fmtTokens(currentOpenCodeOutput)}`,
            `추론 ${fmtTokens(currentOpenCodeReasoning)}`,
            `캐시 쓰기 ${fmtTokens(currentOpenCodeCacheWrite)} · 캐시 읽기 ${fmtTokens(currentOpenCodeCacheRead)}`,
          ].join('\n'),
        },
        `OpenCode ${currentOpenCodeIncomplete ? "partial" : "current desks"} ${amount} · ${fmtTokens(currentOpenCodeTokens)} 토큰`,
      ),
    );
  }
  if (openCodeWaiting) rows.push(h('div.row.muted', { title: "OpenCode의 첫 사용량 보고 이후 표시됩니다." }, "OpenCode 사용량 보고 대기 중"));
  if (currentCodexReports > 0) {
    const amount = currentCodexCostUnknown ? "비용 정보 없음" : fmtCost(currentCodexCost);
    rows.push(
      h(
        'div.row.muted',
        {
          title: [
            "Codex 사용량은 주 세션만 포함합니다. 하위 에이전트 사용량과 비용은 포함하지 않습니다.",
            `입력 ${fmtTokens(currentCodexInput)} · 출력 ${fmtTokens(currentCodexOutput)}`,
            `추론 ${fmtTokens(currentCodexReasoning)}`,
            `캐시 쓰기 ${fmtTokens(currentCodexCacheWrite)} · 캐시 읽기 ${fmtTokens(currentCodexCacheRead)}`,
          ].join('\n'),
        },
        `Codex ${currentCodexIncomplete ? 'partial' : 'current desks'} ${amount} · ${fmtTokens(currentCodexTokens)} 토큰`,
      ),
    );
  }
  if (codexWaiting) rows.push(h('div.row.muted', { title: "Codex 주 세션의 첫 사용량 보고 이후 표시됩니다. 하위 에이전트는 제외합니다." }, "Codex 사용량 보고 대기 중"));
  if (currentDshReports > 0) {
    const context = currentDshContext > 0 ? ` / ${fmtTokens(currentDshContext)}` : '';
    const spend = currentDshCostKnown ? `${fmtCost(currentDshCost)} · ` : '';
    rows.push(
      h(
        'div.row.muted',
        {
          title: [
            "DeepSeek Harness는 작업 후 ACP로 세션의 컨텍스트 사용량을 보고합니다. 비용은 제공되는 경우에만 표시하며 실제 청구액이 아닙니다.",
            `직원 ${currentDshReports}명 · 컨텍스트 토큰 ${fmtTokens(currentDshTokens)}${context}`,
          ].join('\n'),
        },
        `DeepSeek Harness 현재 직원 ${spend}${fmtTokens(currentDshTokens)}${context} 컨텍스트`,
      ),
    );
  }
  if (dshWaiting) rows.push(h('div.row.muted', { title: "DeepSeek Harness의 첫 ACP 사용량 보고 이후 표시됩니다." }, "DeepSeek Harness 사용량 보고 대기 중"));
  if (untracked) {
    rows.push(h('div.row.muted', { title: "직접 지정한 에이전트의 사용량은 집계하지 않습니다." }, "직접 지정한 에이전트의 사용량은 집계하지 않습니다 · 예산과 누적 비용은 Claude Code 기준"));
  }
  el.replaceChildren(...rows);
}
