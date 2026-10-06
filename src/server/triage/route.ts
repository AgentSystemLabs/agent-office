// What triage does with a classified issue: pure, answers and settings in, decision out.
import { TRIAGE_SIZES, type TriageAnswers, type TriageDecision, type TriageModel, type TriagePriority } from '../../shared/protocol.js';
import type { TriageConfig } from './config.js';

/** The label prefixes triage owns: changing one of these by hand opts the issue out. */
export const OWNED_PREFIXES = ['type:', 'area:', 'size:', 'prio:', 'triage:'] as const;
export const isOwnedLabel = (name: string) => OWNED_PREFIXES.some((p) => name.startsWith(p));

/** The triage:* label each decision puts on, if it has one. */
export const DECISION_LABEL: Partial<Record<TriageDecision, string>> = {
  queued: 'triage:queued',
  held: 'triage:ready',
  'needs-human': 'triage:needs-human',
  'needs-detail': 'triage:needs-detail',
  'cross-repo': 'triage:cross-repo',
  'split-me': 'triage:split-me',
};
export const LOW_CONFIDENCE_LABEL = 'triage:low-confidence';

export interface RouteContext {
  /** Queue anyway: skip every rule but needs-human, and every gate. */
  force?: boolean;
  /** The author is a collaborator with write access, or on the floor's authors list. */
  trustedAuthor: boolean;
  /** Tasks triage queued on this floor today. */
  queuedToday: number;
  /** Shadow mode: say what it would do, as though auto-queue were on. */
  shadow?: boolean;
}

export interface Route {
  decision: TriageDecision;
  reason: string;
  /** Every owned label the issue should have; the rest of its owned labels come off. */
  labels: string[];
  lowConfidence: boolean;
  /** Set when it goes on the queue. */
  queue?: { model: TriageModel; priority: number };
  /** Ask for what's missing (needs-detail, when the floor wants that). */
  comment: boolean;
}

const PRIORITY: Record<TriagePriority, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

/** How sure a yes/no answer is, whichever way it went. */
const sure = (p: number) => Math.max(p, 1 - p);

/** The worker for a size, or for Queue anyway on one too big to have its own, the biggest there is. */
function modelFor(cfg: TriageConfig, size: TriageAnswers['size']['value']): TriageModel | undefined {
  const own = cfg.sizeMap[size];
  if (own) return own;
  for (const s of [...TRIAGE_SIZES].reverse()) if (cfg.sizeMap[s]) return cfg.sizeMap[s]!;
  return undefined;
}

export function route(a: TriageAnswers, cfg: TriageConfig, ctx: RouteContext): Route {
  const t = cfg.thresholds;
  const labels: string[] = [];
  let lowConfidence = false;
  const choice = (prefix: string, c: { value: string; p: number }) => {
    if (!c.value) return;
    if (c.p >= t.label) labels.push(prefix + c.value);
    else lowConfidence = true;
  };
  choice('type:', a.type);
  // An area the floor doesn't list isn't one.
  if (cfg.areas.some((x) => x.name === a.area.value)) choice('area:', a.area);
  choice('size:', a.size);
  choice('prio:', a.priority);
  for (const yn of [a.agentReady, a.needsHuman, a.crossRepo]) if (sure(yn.p) < t.label) lowConfidence = true;

  const done = (decision: TriageDecision, reason: string, extra: Partial<Route> = {}): Route => {
    const all = [...labels];
    const status = DECISION_LABEL[decision];
    if (status) all.push(status);
    if (lowConfidence) all.push(LOW_CONFIDENCE_LABEL);
    return { decision, reason, labels: all, lowConfidence, comment: false, ...extra };
  };
  const pct = (p: number) => `${Math.round(p * 100)}%`;

  // 1. Never queued, not even by Queue anyway.
  if (a.needsHuman.p >= t.needsHuman) return done('needs-human', `needs a human (${pct(a.needsHuman.p)})`);

  const priority = PRIORITY[a.priority.value] ?? 3;
  if (ctx.force) {
    const model = modelFor(cfg, a.size.value);
    return model ? done('queued', 'queued by hand', { queue: { model, priority } }) : done('held', 'no model for its size');
  }

  // 2. Nothing for an agent to do.
  if (a.type.value === 'question' || a.type.value === 'duplicate-or-spam') return done('label-only', a.type.value === 'question' ? 'a question' : 'duplicate or spam');
  // 3. Not clear enough to act on.
  if (a.agentReady.p < t.agentReady) return done('needs-detail', `not agent-ready (${pct(a.agentReady.p)})`, { comment: cfg.commentOnNeedsDetail });
  // 4. A human picks the floors.
  if (a.crossRepo.p >= 0.5) return done('cross-repo', 'needs another repo too');
  // 5. Too big for one task.
  const model = cfg.sizeMap[a.size.value];
  if (!model) return done('split-me', `too big (${a.size.value})`);

  // 6. Queued, unless a gate stops it.
  if (lowConfidence) return done('held', 'an answer was unsure');
  if (!ctx.trustedAuthor) return done('held', "author isn't a collaborator");
  if (!ctx.shadow && !cfg.autoQueue) return done('held', 'auto-queue is off');
  if (ctx.queuedToday >= cfg.dailyCap) return done('held', `daily cap (${cfg.dailyCap}) reached`);
  return done('queued', `agent-ready (${pct(a.agentReady.p)}), ${a.size.value}`, { queue: { model, priority } });
}
