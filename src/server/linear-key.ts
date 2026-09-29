// The office's Linear API key. An admin pastes it on the 📌 Issues board (or ⚙️ Settings, or
// --linear-key); it's checked against Linear, then kept in .agent-office/linear.json, which git never
// sees (config.ts excludeFromGit). Clients only ever get a masked hint and who set it, never the key.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LinearKeyState } from '../shared/protocol.js';

interface Saved {
  key: string;
  by: string;
  at: number;
  viewerId?: string;
  viewer?: string;
  workspace?: string;
}

/** What a key check learns: who the key acts as, and where. */
export interface KeyCheck {
  viewerId: string;
  viewer: string;
  workspace: string;
}

/** What the Linear board needs from the key: the key itself, who it is, and a way to say it was refused. */
export interface KeySource {
  key(): string | undefined;
  viewerId(): string | undefined;
  /** The key owner's display name, as Linear shows it on assignees. */
  viewer(): string | undefined;
  failed(why: string): void;
}

const KEY_MAX = 200;

/** "lin_api_…7f3a": the kind of key and its tail, enough to tell two apart. */
function hint(key: string): string {
  const prefix = /^(lin_(?:api|oauth)_)/.exec(key)?.[1] ?? '';
  return `${prefix}…${key.slice(-4)}`;
}

export class LinearKey implements KeySource {
  private saved?: Saved;
  private error?: string;
  private path: string;

  constructor(
    dataDir: string,
    private onState: (state: LinearKeyState) => void,
  ) {
    this.path = path.join(dataDir, 'linear.json');
    this.restore();
  }

  key(): string | undefined {
    return this.saved?.key;
  }

  viewerId(): string | undefined {
    return this.saved?.viewerId;
  }

  viewer(): string | undefined {
    return this.saved?.viewer;
  }

  state(): LinearKeyState {
    if (!this.saved) return {};
    const { key, by, at, viewer, workspace } = this.saved;
    return { key: { hint: hint(key), by, at, viewer, workspace }, error: this.error };
  }

  /**
   * Saves a new key once `check` (a call to Linear as that key) says it works, so a wrong key is
   * refused with Linear's own words and nothing is written. Returns why it can't, if it can't.
   */
  async set(raw: string, by: string, check: (key: string) => Promise<KeyCheck>): Promise<string | undefined> {
    const key = raw.trim();
    if (!key) return 'Paste the API key';
    if (key.length > KEY_MAX || /\s/.test(key)) return "That doesn't look like a Linear API key";
    let who: KeyCheck;
    try {
      who = await check(key);
    } catch (err) {
      return (err as Error).message || 'Linear refused the key';
    }
    this.saved = { key, by, at: Date.now(), viewerId: who.viewerId, viewer: who.viewer, workspace: who.workspace };
    this.error = undefined;
    this.persist();
    this.onState(this.state());
    return undefined;
  }

  /** Forgets the key; the board goes back to asking for one. */
  clear() {
    if (!this.saved && !this.error) return;
    this.saved = undefined;
    this.error = undefined;
    this.persist();
    this.onState(this.state());
  }

  /** Linear turned the saved key away: it stays (someone may have revoked it by mistake), and the board says why. */
  failed(why: string) {
    if (!this.saved || this.error === why) return;
    this.error = why;
    this.onState(this.state());
  }

  private persist() {
    try {
      writeFileSync(this.path, JSON.stringify(this.saved ?? {}, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }

  private restore() {
    if (!existsSync(this.path)) return;
    try {
      const s = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<Saved>;
      if (typeof s.key === 'string' && s.key.trim()) {
        const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
        this.saved = { key: s.key.trim(), by: text(s.by) ?? '?', at: typeof s.at === 'number' ? s.at : Date.now(), viewerId: text(s.viewerId), viewer: text(s.viewer), workspace: text(s.workspace) };
      }
    } catch {
      // a broken file just means no key
    }
  }
}
