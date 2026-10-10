import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { classifyPlaytestIssue, transferredIssueBody, type TriageIssue, type TriageProposal } from '../shared/playtest-triage.js';
import { PlaytestError, type Playtests } from './playtests.js';

export const issueFingerprint = (issue: TriageIssue) => createHash('sha256').update(JSON.stringify([issue.number, issue.url, issue.title, issue.body, issue.updatedAt, issue.state])).digest('hex');
export function previewIssue(issue: TriageIssue): TriageProposal | null {
  const proposal = classifyPlaytestIssue(issue);
  return proposal ? { ...proposal, fingerprint: issueFingerprint(issue) } : null;
}
export interface TriageGitHub {
  read(number: number): Promise<TriageIssue>;
  patch(number: number, body: string, close: boolean): Promise<void>;
}
interface Receipt { fingerprint: string; before: TriageIssue; body: string; close: boolean; tests: { line: number; id: string }[]; state: 'prepared' | 'done'; }
const locks = new Set<string>();

/** Persist tests and a recoverable receipt before editing GitHub. Retry never creates extra tests. */
export async function transferIssue(dataDir: string, number: number, fingerprint: string, tests: Playtests, github: TriageGitHub, actor: string) {
  const key = `${dataDir}:${number}`;
  if (locks.has(key)) throw new PlaytestError('Dieses Issue wird gerade übertragen. Bitte kurz warten.', 409);
  locks.add(key);
  try {
    mkdirSync(dataDir, { recursive: true });
    const file = path.join(dataDir, `playtest-transfer-${number}.json`);
    let receipt: Receipt | undefined = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
    const issue = await github.read(number);
    const save = () => { writeFileSync(`${file}.tmp`, JSON.stringify(receipt, null, 2), { mode: 0o600 }); renameSync(`${file}.tmp`, file); };
    if (receipt?.fingerprint === fingerprint && issue.body === receipt.body && (!receipt.close || issue.state.toUpperCase() === 'CLOSED')) {
      receipt.state = 'done'; save(); return receipt;
    }
    if (issue.state.toUpperCase() !== 'OPEN' || issueFingerprint(issue) !== fingerprint) throw new PlaytestError('Das Issue hat sich geändert. Bitte erneut prüfen; bestehende Playtests bleiben erhalten.', 409);
    const proposal = previewIssue(issue);
    if (!proposal || !proposal.checks.some(c => c.test)) throw new PlaytestError('Keine eindeutig manuellen Tests gefunden. Issue unverändert.', 409);
    const mapped = proposal.checks.filter(c => c.test).map(c => ({ line: c.line, id: tests.add(c.test, actor).id }));
    receipt = { fingerprint, before: issue, body: transferredIssueBody(proposal, mapped), close: proposal.close, tests: mapped, state: 'prepared' };
    save();
    // A second read avoids overwriting edits made while tests were being saved.
    if (issueFingerprint(await github.read(number)) !== fingerprint) throw new PlaytestError('Issue wurde während der Übertragung bearbeitet. Tests sind gesichert; bitte erneut prüfen.', 409);
    await github.patch(number, receipt.body, receipt.close);
    const verified = await github.read(number);
    if (verified.body !== receipt.body || (receipt.close && verified.state.toUpperCase() !== 'CLOSED')) throw new PlaytestError('GitHub-Abschluss noch nicht bestätigt. Bitte erneut prüfen; Tests sind gesichert.', 409);
    receipt.state = 'done'; save();
    return receipt;
  } finally { locks.delete(key); }
}
