import { access, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { isAgentEffort, type AgentEffort } from '../shared/protocol.js';
import { isValidDroidModel } from './agents.js';

export const DROID_SESSIONS_DIR = path.join(homedir(), '.factory', 'sessions');

const SESSION_ID = /^[a-zA-Z0-9-]{1,160}$/;
/** Droid's own bookkeeping file is a few KB; anything bigger isn't one. */
const MAX_BYTES = 1024 * 1024;

/** What a running Droid session is on, whether or not the worker pinned it. */
export interface DroidSessionModel {
  model: string;
  effort?: AgentEffort;
}

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

/**
 * Reads the model and reasoning effort Droid records for a session in
 * `<sessions dir>/<working directory, slashes as dashes>/<session id>.settings.json`. That is the
 * model actually in use, including the one droid picked from its own settings when the worker
 * pinned nothing, and one changed with /model since.
 */
export class DroidSessionReader {
  private files = new Map<string, string>();

  constructor(private root: string = DROID_SESSIONS_DIR) {}

  async read(sessionId: string, cwd: string): Promise<DroidSessionModel | undefined> {
    if (!SESSION_ID.test(sessionId)) return undefined;
    const file = await this.find(sessionId, cwd);
    if (!file) return undefined;
    try {
      const text = await readFile(file, 'utf8');
      if (text.length > MAX_BYTES) return undefined;
      const raw = JSON.parse(text) as Record<string, unknown> | null;
      if (!raw || typeof raw !== 'object' || !isValidDroidModel(raw.model)) return undefined;
      return { model: raw.model, ...(isAgentEffort(raw.reasoningEffort) ? { effort: raw.reasoningEffort } : {}) };
    } catch {
      // being rewritten, or gone: the next hook asks again
      return undefined;
    }
  }

  private async find(sessionId: string, cwd: string): Promise<string | undefined> {
    const known = this.files.get(sessionId);
    if (known && (await exists(known))) return known;
    this.files.delete(sessionId);
    const name = `${sessionId}.settings.json`;
    const guess = path.join(this.root, cwd.replace(/[^a-zA-Z0-9-]/g, '-'), name);
    let found = (await exists(guess)) ? guess : undefined;
    // How droid spells a directory isn't documented, so fall back to looking in each one.
    if (!found) {
      for (const dir of await readdir(this.root).catch(() => [] as string[])) {
        const candidate = path.join(this.root, dir, name);
        if (await exists(candidate)) {
          found = candidate;
          break;
        }
      }
    }
    if (found) this.files.set(sessionId, found);
    return found;
  }
}
