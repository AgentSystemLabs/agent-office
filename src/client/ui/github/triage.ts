import './triage.css';
import type { TriageDecision, TriageResult } from '../../../shared/protocol';
import type { Net } from '../../net';
import { store } from '../../state';
import { h } from '../dom';

// ---- Triage on the issues board (see server/triage/) ----------------------------------------------

const DECISION: Record<TriageDecision, string> = {
  queued: 'queued',
  held: 'ready, held',
  'needs-human': 'needs a human',
  'label-only': 'labelled only',
  'needs-detail': 'needs detail',
  'cross-repo': 'cross-repo',
  'split-me': 'split it up',
  'opted-out': 'labels changed by hand',
  error: 'failed',
};

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Every answer with its probability, for the badge's tooltip. */
function details(r: TriageResult): string {
  const lines = [`${DECISION[r.decision]}: ${r.reason}${r.shadow ? ' (shadow mode: nothing written to GitHub)' : ''}`];
  const a = r.answers;
  if (a) {
    lines.push(
      `type: ${a.type.value} ${pct(a.type.p)}`,
      ...(a.area.value ? [`area: ${a.area.value} ${pct(a.area.p)}`] : []),
      `size: ${a.size.value} ${pct(a.size.p)}`,
      `priority: ${a.priority.value} ${pct(a.priority.p)}`,
      `agent-ready: ${pct(a.agentReady.p)} yes`,
      `needs a human: ${pct(a.needsHuman.p)} yes`,
      `cross-repo: ${pct(a.crossRepo.p)} yes`,
    );
  }
  if (r.lowConfidence) lines.push('some answers were too unsure to label');
  if (r.model) lines.push(`worker: ${r.model.provider}${r.model.model ? ` ${r.model.model}` : ''}${r.model.effort ? ` (${r.model.effort})` : ''}`);
  if (r.error) lines.push(`error: ${r.error}`);
  return lines.join('\n');
}

/** An issue card's triage chip: its type and size, and a dot for what triage did. */
export function triageChip(issue: number): Node | '' {
  if (!store.triage.enabled) return '';
  const r = store.triageFor(issue);
  if (!r) return '';
  const what = r.answers ? `${r.answers.type.value} · ${r.answers.size.value}` : DECISION[r.decision];
  return h(`span.tchip.${r.decision}${r.lowConfidence ? '.unsure' : ''}`, { title: details(r) }, h('i.tdot'), what);
}

/** The issue window's triage row: what it decided, and Re-classify and Queue anyway. */
export function triageRow(issue: number, net: Net): Node | null {
  if (!store.triage.enabled) return null;
  const r = store.triageFor(issue);
  const chip = triageChip(issue);
  const reclassify = h('button.btn.small', { type: 'button', title: 'Classify it again; labels changed by hand are taken back by triage', onclick: () => net.send({ t: 'triage.reclassify', number: issue }) }, '🏷️ Re-classify');
  const canQueue = !!r?.answers && r.decision !== 'needs-human' && r.decision !== 'queued';
  const anyway = canQueue ? h('button.btn.small', { type: 'button', title: 'Put it on the queue though triage held it back', onclick: () => net.send({ t: 'triage.queueAnyway', number: issue }) }, '📋 Queue anyway') : null;
  return h('div.triage-row', {}, h('span', {}, '🏷️ Triage:'), chip || h('span.gh-quiet', {}, 'not classified yet'), r ? h('span.gh-quiet', {}, r.reason) : null, reclassify, anyway);
}

/** The floor's triage today, for the queue board. */
export function triageStats(): string {
  const t = store.triage;
  if (!t.enabled) return '';
  const s = t.stats;
  return `🏷️ Triage today: ${s.triaged} classified · ${s.queued}/${s.cap} auto-queued${s.spend ? ` · $${s.spend.toFixed(2)} Jev` : ''}`;
}
