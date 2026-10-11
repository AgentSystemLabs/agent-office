import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DECISION_CATEGORIES, orderDecisions, type Decision, type DecisionInput } from '../../shared/decisions.js';
export class DecisionError extends Error { constructor(message: string, public status = 400) { super(message); } }
export interface Actor { name: string; owner?: string; worker?: { id: string; name: string }; admin?: boolean }
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new DecisionError('Text fehlt oder ist zu lang.');
  return value.trim();
}
export function input(raw: unknown): DecisionInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new DecisionError('Entscheidungsfrage fehlt.');
  const b = raw as Record<string, unknown>;
  const strings = (v: unknown, count: number, length: number) => {
    if (!Array.isArray(v) || v.length > count) throw new DecisionError('Ungültige Liste.');
    return [...new Set(v.map(s => text(s, length, true)))];
  };
  const issues = b.issues ?? [];
  if (!Array.isArray(issues) || issues.length > 20 || issues.some(n => !Number.isSafeInteger(n) || n < 1)) throw new DecisionError('Ungültige Issue-Nummern.');
  if (!DECISION_CATEGORIES.includes(b.category as any)) throw new DecisionError('Kategorie auswählen.');
  if (typeof b.blocking !== 'boolean') throw new DecisionError('Blockierungsstatus fehlt.');
  return { title: text(b.title, 180, true), question: text(b.question, 4000, true), context: text(b.context ?? '', 6000),
    options: strings(b.options ?? [], 8, 500), recommendation: text(b.recommendation ?? '', 1000), category: b.category as string,
    tags: strings(b.tags ?? [], 12, 40), issues: [...new Set(issues)], blocking: b.blocking, blockingReason: text(b.blockingReason ?? '', 1000, b.blocking) };
}
export const canAnswer = (d: Decision, actor: Actor) => !actor.worker && (actor.admin || (!d.owner && !actor.owner) || (!!d.owner && actor.owner === d.owner));
const fingerprint = (d: DecisionInput) => JSON.stringify([d.question.trim().toLocaleLowerCase().replace(/\s+/g, ' '), [...d.issues].sort((a,b) => a-b)]);
export class Decisions {
  private file: string;
  constructor(dir: string, project: string) { this.file = path.join(dir, 'decisions', createHash('sha256').update(project.toLowerCase()).digest('hex').slice(0, 24) + '.json'); }
  list(): Decision[] {
    if (!existsSync(this.file)) return [];
    const data = JSON.parse(readFileSync(this.file, 'utf8'));
    if (!Array.isArray(data.items) || data.items.some((d: Decision) => !d.id || !Number.isSafeInteger(d.revision))) throw new DecisionError('Entscheidungsspeicher beschädigt; Daten wurden nicht überschrieben.', 503);
    return orderDecisions(data.items);
  }
  private save(items: Decision[]) {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.' + randomUUID() + '.tmp';
    writeFileSync(temp, JSON.stringify({ items }), { mode: 0o600 }); renameSync(temp, this.file);
  }
  add(raw: unknown, actor: Actor): Decision {
    const value = input(raw), items = this.list();
    const existing = items.find(d => fingerprint(d) === fingerprint(value));
    if (existing) {
      // Retries and repeated scans never overwrite a human answer or silently reopen it.
      let changed = false;
      if (actor.worker && !existing.workers.some(w => w.id === actor.worker!.id)) {
        existing.workers.push(actor.worker); changed = true;
      }
      if (existing.status === 'open' && value.blocking && !existing.blocking) { existing.blocking = true; existing.blockingReason = value.blockingReason; changed = true; }
      if (changed) { existing.revision++; existing.updatedAt = Date.now(); this.save(items); }
      return existing;
    }
    if (items.length >= 2000) throw new DecisionError('Entscheidungspool ist voll.', 409);
    const now = Date.now();
    const item: Decision = { ...value, id: randomUUID(), revision: 1, status: 'open', createdAt: now, updatedAt: now, createdBy: actor.name,
      owner: actor.owner, workers: actor.worker ? [actor.worker] : [], history: [] };
    items.push(item); this.save(items); return item;
  }
  change(id: string, revision: number, actor: Actor, mutate: (d: Decision) => void): Decision {
    const items = this.list(), item = items.find(d => d.id === id);
    if (!item) throw new DecisionError('Entscheidung nicht gefunden.', 404);
    if (!canAnswer(item, actor)) throw new DecisionError('Diese Entscheidung beantwortet der zuständige Mensch.', 403);
    if (item.revision !== revision) throw new DecisionError('Die Entscheidung wurde inzwischen geändert. Bitte aktualisieren.', 409);
    mutate(item); item.revision++; item.updatedAt = Date.now(); this.save(items); return item;
  }
  answer(id: string, revision: number, value: unknown, actor: Actor) {
    const answer = text(value, 6000, true);
    return this.change(id, revision, actor, d => { d.answer = answer; d.answeredBy = actor.name; d.answeredAt = Date.now(); d.status = 'answered';
      d.history.push({ answer, by: actor.name, at: d.answeredAt }); d.notified = {}; });
  }
}
