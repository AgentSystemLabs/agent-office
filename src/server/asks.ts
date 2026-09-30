// Questions an agent asks the people in the office: `office-ask` (bin/office-ask.js) posts one and
// waits, the office shows it as a dialog, and whatever gets picked or typed goes back as the answer.
// Only the question is kept here; whose it is and what the worker's status does is workers.ts's job.

import { randomBytes } from 'node:crypto';
import type { WorkerAsk } from '../shared/protocol.js';

interface Pending {
  ask: WorkerAsk;
  /** Set when it was answered while nobody was waiting (the agent's command timed out and hasn't come back yet). */
  answer?: string;
  waiters: Set<(answer: string | null) => void>;
}

export const ASK_LABEL_MAX = 120;
export const ASK_OPTIONS_MAX = 8;
export const ASK_ANSWER_MAX = 4000;

/** What an agent posted, cleaned up: a question, and options only when it gave at least two. */
export function cleanAsk(body: unknown): Omit<WorkerAsk, 'id'> | string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const question = typeof b.question === 'string' ? b.question.trim().slice(0, 1000) : '';
  if (!question) return 'Send a question';
  const options = (Array.isArray(b.options) ? b.options : [])
    .map((o) => (typeof o === 'string' ? { label: o } : (o as { label?: unknown; description?: unknown })))
    .filter((o) => typeof o?.label === 'string' && o.label.trim())
    .slice(0, ASK_OPTIONS_MAX)
    .map((o) => ({ label: String(o.label).trim().slice(0, ASK_LABEL_MAX), ...(typeof o.description === 'string' && o.description.trim() ? { description: o.description.trim().slice(0, 300) } : {}) }));
  const header = typeof b.header === 'string' && b.header.trim() ? b.header.trim().slice(0, 40) : undefined;
  return { question, ...(header ? { header } : {}), options: options.length >= 2 ? options : [], multi: b.multi === true && options.length >= 2 };
}

export class Asks {
  private pending = new Map<string, Pending>();

  /** The question a worker is waiting on, if any. */
  current(workerId: string): WorkerAsk | undefined {
    return this.pending.get(workerId)?.ask;
  }

  /**
   * Posts a worker's question and resolves with the answer, or null after `holdMs` with none. Asking
   * the same question again (the agent's command timed out) picks up where it left off, including an
   * answer that came in meanwhile. A different question replaces the old one.
   */
  ask(workerId: string, q: Omit<WorkerAsk, 'id'>, holdMs: number): { ask: WorkerAsk; fresh: boolean; answer: Promise<string | null> } {
    let p = this.pending.get(workerId);
    const fresh = !p || p.ask.question !== q.question;
    if (p && fresh) this.drop(workerId);
    if (fresh) {
      p = { ask: { id: randomBytes(4).toString('hex'), ...q }, waiters: new Set() };
      this.pending.set(workerId, p);
    }
    const pending = p!;
    if (pending.answer !== undefined) {
      const answer = pending.answer;
      this.pending.delete(workerId);
      return { ask: pending.ask, fresh, answer: Promise.resolve(answer) };
    }
    const answer = new Promise<string | null>((resolve) => {
      const done = (a: string | null) => {
        clearTimeout(timer);
        pending.waiters.delete(done);
        resolve(a);
      };
      const timer = setTimeout(() => done(null), holdMs);
      pending.waiters.add(done);
    });
    return { ask: pending.ask, fresh, answer };
  }

  /** Someone's answer. False when that question is gone (already answered, or the worker moved on). */
  answer(workerId: string, id: string, text: string): boolean {
    const p = this.pending.get(workerId);
    if (!p || p.ask.id !== id || p.answer !== undefined) return false;
    const clean = text.replace(/\r\n?/g, '\n').trim().slice(0, ASK_ANSWER_MAX);
    if (!clean) return false;
    if (p.waiters.size) {
      this.pending.delete(workerId);
      for (const w of [...p.waiters]) w(clean);
    } else p.answer = clean;
    return true;
  }

  /** The worker is gone or was sent on: whatever it was waiting for is off. */
  drop(workerId: string) {
    const p = this.pending.get(workerId);
    if (!p) return;
    this.pending.delete(workerId);
    for (const w of [...p.waiters]) w(null);
  }
}
