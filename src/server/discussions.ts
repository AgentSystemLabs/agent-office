import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export interface Discussion {
  id: string;
  topic: string;
  first: string;
  second: string;
  next: string;
  limit: number;
  messages: { from: string; text: string; at: number }[];
  pending?: { to: string; prompt: string };
  finished?: boolean;
}

/** One bounded conversation between two existing workers on a floor. Its outstanding turn survives restarts. */
export class Discussions {
  private file: string;
  private current?: Discussion;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'discussions.json');
    try {
      const value = JSON.parse(readFileSync(this.file, 'utf8')) as Discussion;
      if (value && typeof value.id === 'string' && Array.isArray(value.messages)) this.current = value;
    } catch { /* first run or damaged state */ }
  }

  active(): Discussion | undefined { return this.current; }

  start(first: string, second: string, topic: string, limit: number): Discussion | string {
    const id = randomBytes(5).toString('hex');
    this.current = {
      id, first, second, topic, next: first, limit, messages: [],
      pending: { to: first, prompt: `Discussion ${id} with the other worker. Topic: ${topic}\n\nYou own implementation. The other worker independently reviews and does not edit this checkout. Prioritize robustness, efficiency, optimality, and long-term maintainability. Look for root causes, important edge cases, and practical tradeoffs. If this topic asks for implementation, do the work and include changed files and verification in your first reply; otherwise share a concrete plan and a question for review. Send your response with office-workers discuss ${id}, putting the message on stdin with a quoted here-document. The exchange is visible in Office chat. Do not use tell_worker for this discussion. At most ${limit} total messages; stop when the office says it is complete.` },
    };
    this.save();
    return this.current;
  }

  post(id: string, from: string, text: string): Discussion | string {
    const d = this.current;
    if (!d || d.id !== id) return 'No such discussion';
    if (d.finished) return 'This discussion is complete';
    if (d.next !== from) return 'Wait for your turn';
    if (d.pending) return 'Your turn has not been delivered yet';
    d.messages.push({ from, text, at: Date.now() });
    if (d.messages.length >= d.limit) d.finished = true;
    else {
      const to = from === d.first ? d.second : d.first;
      d.next = to;
      const last = d.messages.length === d.limit - 1;
      d.pending = { to, prompt: `Discussion ${id}, message ${d.messages.length + 1}/${d.limit}. Topic: ${d.topic}\n\n${from === d.first ? 'The implementation owner' : 'The independent reviewer'} said:\n${text}\n\n${to === d.second ? 'You are the independent reviewer. Read relevant code if useful, but do not edit the shared checkout. Identify material correctness, security, performance, and maintainability issues and offer concrete improvements.' : 'You own implementation. Consider the review and explain your decision or next steps. Keep the reviewer independent.'} Prioritize robustness, efficiency, optimality, and long-term maintainability. ${last ? 'This is the final reply. Summarize the decision, remaining risks, and who does what next.' : 'Respond with a concise, actionable message.'} Send it with office-workers discuss ${id}, putting the message on stdin with a quoted here-document. Do not use tell_worker for this discussion.` };
    }
    this.save();
    return d;
  }

  pending(): Discussion['pending'] { return this.current?.pending; }

  delivered(): void {
    if (!this.current?.pending) return;
    delete this.current.pending;
    this.save();
  }

  cancel(): void {
    if (!this.current) return;
    this.current.finished = true;
    delete this.current.pending;
    this.save();
  }

  private save(): void {
    try { writeFileSync(this.file, JSON.stringify(this.current), { mode: 0o600 }); }
    catch { /* chat still works if this disk is temporarily unavailable */ }
  }
}
