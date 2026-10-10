import { mkdirSync, readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { QueueTask } from '../shared/protocol.js';
import type { PlaytestInput } from '../shared/playtests.js';

export interface DeliveryRequest {
  issue: number;
  pr: number;
  head: string;
  summary: string;
  technicalEvidence: string;
  implementationComplete: true;
  remainingImplementation: [];
  criteria: { text: string; kind: 'implemented' | 'manual'; evidence?: string; test?: PlaytestInput; testId?: string }[];
  manualTests?: PlaytestInput[];
}
export interface DeliveryReceipt {
  issue: number; pr: number; url: string; title: string; head: string; mergedAt: string;
  completedAt: number; tests: string[];
}
export function acceptanceItems(body: string): string[] {
  return [...body.matchAll(/^\s*[-*]\s+\[[ xX]\]\s+(.+)$/gm)].map(m => m[1].trim());
}
export function validateDelivery(value: unknown, issueBody: string): DeliveryRequest {
  const r = value as DeliveryRequest;
  if (!r || !Number.isSafeInteger(r.issue) || r.issue < 1 || !Number.isSafeInteger(r.pr) || r.pr < 1 ||
      !/^[a-f0-9]{40}$/i.test(r.head ?? '') || r.implementationComplete !== true ||
      !Array.isArray(r.remainingImplementation) || r.remainingImplementation.length ||
      typeof r.summary !== 'string' || !r.summary.trim() || r.summary.length > 4000 ||
      typeof r.technicalEvidence !== 'string' || !r.technicalEvidence.trim() || r.technicalEvidence.length > 8000 ||
      !Array.isArray(r.criteria) || (r.manualTests !== undefined && (!Array.isArray(r.manualTests) || r.manualTests.length > 100))) throw new Error('Require issue, merged PR, exact head, summary, technicalEvidence, implementationComplete:true and remainingImplementation:[]');
  const expected = acceptanceItems(issueBody);
  if (r.criteria.length !== expected.length || r.criteria.some((c, i) => !c || c.text !== expected[i]))
    throw new Error('Account for every issue checkbox, in order, using its exact current text');
  for (const c of r.criteria) {
    if (c.kind === 'implemented') {
      if (typeof c.evidence !== 'string' || !c.evidence.trim() || c.evidence.length > 4000) throw new Error('Implemented criteria need evidence');
    } else if (c.kind === 'manual') {
      if (!c.test && !c.testId) throw new Error('Manual criteria need a checklist test or an existing testId');
    } else throw new Error('A criterion must be implemented or handed to the human checklist');
  }
  return r;
}

export interface DeliveryDeps {
  issue(): Promise<{ body: string; state: string; url: string }>;
  pull(): Promise<{ state: string; head: string; base: string; defaultBranch: string; url: string; title: string; mergedAt: string; references: boolean; failedChecks: boolean }>;
  validateTest(test: unknown): PlaytestInput;
  saveTest(test: PlaytestInput): { id: string };
  findTest(id: string): { id: string; source: string } | undefined;
  close(comment: string): Promise<void>;
  record(receipt: DeliveryReceipt): void;
}
/** The order is deliberate: checklist failure must never close the issue. Retrying repairs partial completion. */
export async function completeDelivery(value: unknown, deps: DeliveryDeps): Promise<DeliveryReceipt> {
  const issue = await deps.issue();
  const request = validateDelivery(value, issue.body);
  const pr = await deps.pull();
  if (pr.state !== 'MERGED' || pr.head !== request.head || pr.base !== pr.defaultBranch || !pr.references || pr.failedChecks || !Number.isFinite(Date.parse(pr.mergedAt)))
    throw new Error('PR must reference this issue, be merged into the default branch at the reviewed head, and have no failed checks');
  // Validate all inputs before saving any; use the issue URL for deterministic, cross-PR deduplication.
  const manual = request.criteria.filter(c => c.kind === 'manual');
  const reused = manual.filter(c => c.testId).map(c => {
    const test = deps.findTest(c.testId!);
    if (!test || ![issue.url, pr.url].includes(test.source.replace(/\/$/, ''))) throw new Error('Existing checklist test must belong to this issue or PR');
    return test.id;
  });
  const tests = [...manual.filter(c => !c.testId).map(c => c.test!), ...(request.manualTests ?? [])].map(t => deps.validateTest({ ...t, source: issue.url }));
  const ids = [...new Set([...reused, ...tests.map(t => deps.saveTest(t).id)])];
  const current = await deps.issue();
  if (current.body !== issue.body) throw new Error('Issue requirements changed during handoff; review them again');
  if (current.state !== 'CLOSED') {
    await deps.close([
      `Implementation completed in ${pr.url} (reviewed head ${pr.head}).`, request.summary,
      `Technical evidence: ${request.technicalEvidence}`,
      ...request.criteria.map(c => c.kind === 'implemented' ? `- Implemented: ${c.text}\n  Evidence: ${c.evidence}` : `- Human playtest, transferred: ${c.text}`),
      ids.length ? `Human checks are saved in the Office Playtest checklist (${ids.join(', ')}). They remain unperformed unless checked by the owner and do not block this coding issue.` : 'No manual acceptance checks were identified by the reviewer.',
      '<!-- office-issue-delivery -->',
    ].join('\n\n'));
  }
  if ((await deps.issue()).state !== 'CLOSED') throw new Error('Issue closure was not confirmed by GitHub');
  const receipt = { issue: request.issue, pr: request.pr, url: pr.url, title: pr.title, head: pr.head, mergedAt: pr.mergedAt, completedAt: Date.now(), tests: ids };
  deps.record(receipt);
  return receipt;
}

export class IssueDeliveries {
  private file: string;
  private receipts: DeliveryReceipt[];
  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'issue-deliveries.json');
    this.receipts = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : [];
    if (!Array.isArray(this.receipts)) throw new Error('Invalid issue delivery records');
  }
  record(receipt: DeliveryReceipt): void {
    const next = [...this.receipts.filter(r => r.issue !== receipt.issue), receipt];
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
    this.receipts = next;
  }
  /** No dispatch, removal, or worker interruption. Tasks created after the merge remain separate work. */
  reconcile(tasks: QueueTask[]): boolean {
    let changed = false;
    for (const t of tasks) {
      const r = this.receipts.find(r => r.issue === t.issue && t.addedAt <= Date.parse(r.mergedAt));
      if (!r) continue;
      const pr = Object.assign({ number: r.pr, url: r.url, title: r.title, state: 'MERGED' }, { coversTask: true, checks: 'none' });
      if (t.status === 'done' && t.outcome === 'done' && JSON.stringify(t.pr) === JSON.stringify(pr)) continue;
      t.status = 'done'; t.outcome = 'done'; t.pr = pr; t.finishedAt = r.completedAt;
      delete t.error;
      delete (t as QueueTask & { waitingReason?: string }).waitingReason;
      changed = true;
    }
    return changed;
  }
}
