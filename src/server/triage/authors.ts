// Whose issues triage may put on the queue: the repo's collaborators with write access, and the
// floor's own list. Anyone else's issue text could steer the worker that picks it up.
import type { GhRun } from './labels.js';

const TTL_MS = 60 * 60_000;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export class Collaborators {
  private known = new Map<string, { ok: boolean; at: number }>();
  constructor(private run: GhRun) {}

  async trusted(login: string, extra: string[], now = Date.now()): Promise<boolean> {
    const who = login.toLowerCase();
    if (extra.includes(who)) return true;
    if (!LOGIN.test(login)) return false;
    const hit = this.known.get(who);
    if (hit && now - hit.at < TTL_MS) return hit.ok;
    let ok = false;
    try {
      const perm = (await this.run(['api', `repos/{owner}/{repo}/collaborators/${login}/permission`, '--jq', '.permission'])).trim();
      ok = perm === 'admin' || perm === 'write' || perm === 'maintain';
    } catch {
      // Not a collaborator (404), or GitHub didn't answer: not trusted, and asked again later.
    }
    this.known.set(who, { ok, at: now });
    return ok;
  }
}
