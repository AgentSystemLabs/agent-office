import { createHash } from 'node:crypto';

export const BUSY = new Set(['starting', 'working', 'needs_input']);
const HELD = new Set(['execution:held', 'no-agent', 'status:held', 'status:paused', 'status:blocked', 'status:done', 'status:archived', 'status:review', 'status:in-progress']);

export function fingerprint(issue) {
  return createHash('sha256').update(JSON.stringify([issue.number, issue.updatedAt, issue.body, issue.labels.map(label => label.name).sort()])).digest('hex');
}

/** Only a ready task can execute. Other unheld issues may be assessed for a task contract. */
export function candidates(issues, { owner, reserved = [], completed = [], inspected = {} }) {
  const reservedIds = new Set(reserved);
  const completedRuns = new Set(completed);
  return issues.filter(issue => {
    const labels = new Set(issue.labels.map(label => label.name.toLowerCase()));
    if (issue.author?.login !== owner || reservedIds.has(issue.number) || issue.assignees?.length) return false;
    if ([...HELD].some(label => labels.has(label))) return false;
    const runs = [...(issue.body || '').matchAll(/<!-- fox-runtime-run:([A-Za-z0-9-]{8,80}) -->/g)].map(match => match[1]);
    if (runs.some(run => completedRuns.has(run))) return false;
    return inspected[issue.number] !== fingerprint(issue);
  }).map(issue => ({ ...issue, mode: issue.labels.some(label => label.name === 'execution:ready') ? 'validate-ready-contract' : 'prepare-contract-only' }));
}

export function gate({ now, config, state, workers, externalPending = [] }) {
  if (!config.enabled) return 'disabled';
  if (now >= config.expiresAt || state.rounds.length >= config.maxRounds) return 'budget-finished';
  if (externalPending.length) return 'external-reconciliation';
  if (state.rounds.some(round => round.state === 'uncertain')) return 'needs-reconciliation';
  if (workers.some(worker => BUSY.has(worker.status))) return 'waiting-for-team';
  return 'ready';
}

export function decisionsOf(value, round) {
  if (value?.cycle_id !== round.id || !Array.isArray(value.decisions)) throw new Error('A matching cycle manifest is required');
  const allowed = new Set(round.issues.map(issue => issue.number));
  const seen = new Set();
  return value.decisions.map(decision => {
    if (!allowed.has(decision.issue) || seen.has(decision.issue) || !['assigned', 'blocked', 'already-claimed', 'needs-contract', 'completed'].includes(decision.action) || typeof decision.reason !== 'string' || !decision.reason.trim()) throw new Error('Invalid decision');
    seen.add(decision.issue);
    return { issue: decision.issue, action: decision.action, reason: decision.reason.slice(0, 2000) };
  });
}
