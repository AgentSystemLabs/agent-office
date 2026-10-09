// A floor's triage settings: <floor>/.agent-office/triage.json, written by hand. Anything missing or
// wrong falls back to its default, with a warning for the log.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TRIAGE_SIZES, isAgentEffort, isAgentProvider, type TriageModel, type TriageSize } from '../../shared/protocol.js';
import { validateWorkerEffort, validateWorkerModel } from '../agents.js';

export interface TriageArea {
  name: string;
  /** A sentence saying what's in it, for the classifier. */
  description: string;
}

export interface TriageConfig {
  /** Classify this floor's issues at all (when the office runs with --triage). */
  enabled: boolean;
  /** Write labels and comments to GitHub; off is shadow mode, which only shows the badges. */
  writeLabels: boolean;
  /** Put issues that pass every rule on the queue (needs writeLabels too). */
  autoQueue: boolean;
  /** Post one comment on a needs-detail issue asking for what's missing. */
  commentOnNeedsDetail: boolean;
  /** The repo in a line, for the classifier; the GitHub description when empty. */
  description: string;
  areas: TriageArea[];
  thresholds: {
    /** agentReady must be at least this sure for an issue to be queued. */
    agentReady: number;
    /** needsHuman at or over this stops it for good. */
    needsHuman: number;
    /** An answer less sure than this isn't written as a label. */
    label: number;
  };
  /** The worker each size gets; null: not queued (split it up). */
  sizeMap: Record<TriageSize, TriageModel | null>;
  /** Auto-queued tasks per day on this floor, at most. */
  dailyCap: number;
  /** Authors whose issues may be auto-queued besides the repo's collaborators with write access. */
  authors: string[];
}

export const DEFAULT_TRIAGE: TriageConfig = {
  enabled: true,
  writeLabels: false,
  autoQueue: false,
  commentOnNeedsDetail: true,
  description: '',
  areas: [],
  thresholds: { agentReady: 0.85, needsHuman: 0.5, label: 0.6 },
  sizeMap: {
    xs: { provider: 'claude', model: 'sonnet', effort: 'low' },
    s: { provider: 'claude', model: 'sonnet', effort: 'low' },
    m: { provider: 'claude', model: 'sonnet', effort: 'medium' },
    l: { provider: 'claude', model: 'opus', effort: 'high' },
    xl: null,
  },
  dailyCap: 10,
  authors: [],
};

const AREA_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const prob = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);

function model(v: unknown, size: string, warn: (s: string) => void): TriageModel | null | undefined {
  if (v === null) return null;
  if (!v || typeof v !== 'object') return undefined;
  const m = v as Record<string, unknown>;
  if (!isAgentProvider(m.provider)) return warn(`sizeMap.${size}: unknown provider`), undefined;
  const bad = validateWorkerModel('agent', m.provider, m.model) ?? validateWorkerEffort('agent', m.provider, m.effort);
  if (bad) return warn(`sizeMap.${size}: ${bad}`), undefined;
  return { provider: m.provider, model: typeof m.model === 'string' ? m.model : undefined, effort: isAgentEffort(m.effort) ? m.effort : undefined };
}

/** Makes a config out of whatever the file held. */
export function parseTriageConfig(raw: unknown, warn: (s: string) => void = () => {}): TriageConfig {
  const d = DEFAULT_TRIAGE;
  const r = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const areas: TriageArea[] = [];
  for (const a of Array.isArray(r.areas) ? r.areas : []) {
    const name = typeof a?.name === 'string' ? a.name.trim().toLowerCase() : '';
    if (!AREA_NAME.test(name)) warn(`areas: "${name}" isn't a name a label can have (a-z, 0-9, -)`);
    else if (!areas.some((x) => x.name === name)) areas.push({ name, description: typeof a.description === 'string' ? a.description.slice(0, 300) : '' });
  }
  const sizeMap = { ...d.sizeMap };
  if (r.sizeMap && typeof r.sizeMap === 'object')
    for (const s of TRIAGE_SIZES) {
      if (!(s in r.sizeMap)) continue;
      const m = model(r.sizeMap[s], s, warn);
      if (m !== undefined) sizeMap[s] = m;
    }
  const t = r.thresholds ?? {};
  return {
    enabled: bool(r.enabled, d.enabled),
    writeLabels: bool(r.writeLabels, d.writeLabels),
    autoQueue: bool(r.autoQueue, d.autoQueue),
    commentOnNeedsDetail: bool(r.commentOnNeedsDetail, d.commentOnNeedsDetail),
    description: typeof r.description === 'string' ? r.description.slice(0, 300) : d.description,
    areas,
    thresholds: { agentReady: prob(t.agentReady, d.thresholds.agentReady), needsHuman: prob(t.needsHuman, d.thresholds.needsHuman), label: prob(t.label, d.thresholds.label) },
    sizeMap,
    dailyCap: Number.isInteger(r.dailyCap) && r.dailyCap >= 0 ? r.dailyCap : d.dailyCap,
    authors: Array.isArray(r.authors) ? r.authors.filter((a: unknown): a is string => typeof a === 'string').map((a: string) => a.toLowerCase()) : d.authors,
  };
}

/** The floor's triage.json, read afresh each time so edits take without a restart. */
export function loadTriageConfig(dataDir: string, warn?: (s: string) => void): TriageConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path.join(dataDir, 'triage.json'), 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') warn?.(`triage.json: ${(err as Error).message}`);
  }
  return parseTriageConfig(raw, warn);
}
