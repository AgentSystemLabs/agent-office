import type { Decision, DecisionFollowup } from '../../shared/decisions.js';
import { DecisionError } from './store.js';

export const FOLLOWUP_LEASE_MS = 15 * 60_000;
export const FOLLOWUP_RECHECK_MS = 6 * 60 * 60_000;
export const followupFor = (answerAt: number): DecisionFollowup => ({ answerAt, status: 'pending', updatedAt: Date.now(), issueNumbers: [], evidence: '', note: '' });

export function dueFollowup(d: Decision, now: number): boolean {
  if (d.status !== 'answered' || !d.answer || !d.followup) return false;
  const f = d.followup;
  if (f.status === 'pending') return (f.retryAt ?? 0) <= now;
  if (f.status === 'dispatching') return f.updatedAt + FOLLOWUP_LEASE_MS <= now;
  if (f.status === 'issue_linked') return (f.checkedAt ?? f.updatedAt) + FOLLOWUP_RECHECK_MS <= now;
  return false;
}

export type FollowupOutcome = 'issue_linked' | 'merged' | 'no_action' | 'needs_clarification';
export function followupReport(raw: unknown): { status: FollowupOutcome; issueNumbers: number[]; evidence: string; note: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new DecisionError('Abgleich-Ergebnis fehlt.');
  const b = raw as Record<string, unknown>;
  if (!['issue_linked', 'merged', 'no_action', 'needs_clarification'].includes(String(b.status))) throw new DecisionError('Ungültiger Abgleich-Status.');
  if (!Array.isArray(b.issueNumbers) || b.issueNumbers.length > 20 || b.issueNumbers.some(n => !Number.isSafeInteger(n) || n < 1)) throw new DecisionError('Ungültige Issue-Nummern.');
  if (typeof b.evidence !== 'string' || b.evidence.length > 4000 || typeof b.note !== 'string' || b.note.length > 4000 || !b.note.trim()) throw new DecisionError('Begründung fehlt oder ist zu lang.');
  if (b.status === 'issue_linked' && !b.issueNumbers.length) throw new DecisionError('Ein Issue-Link ist erforderlich.');
  if ((b.status === 'merged' || b.status === 'no_action') && !b.evidence.trim()) throw new DecisionError('Nachweis fehlt.');
  return { status: b.status as FollowupOutcome, issueNumbers: [...new Set(b.issueNumbers as number[])], evidence: b.evidence.trim(), note: b.note.trim() };
}
