import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HostState, PairingCode } from '../shared/protocol.js';
import { FLOORHOST_PROTOCOL } from '../shared/floorhost.js';
import { safeEq } from './secrets.js';

/** A pairing code is short-lived by design: it is a one-time bearer for a machine you are admitting. */
export const PAIRING_TTL_MS = 30 * 60 * 1000;
const MAX_CODES = 20;
const MAX_HOSTS = 50;
/** Long enough to type, short enough not to be guessed: 8 Crockford-ish characters, no I/L/O/U. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A machine that may host floors in this office. */
export interface Host {
  id: string;
  /** What the office shows its people: "Alice's laptop". Set at pairing, so refusals can name it. */
  name: string;
  /** sha256 of the token, hex. The token itself is shown once, at pairing, and never stored. */
  hash: string;
  /** Whose machine it is, for the pairing dialog and the desk signs. Not a permission. */
  owner?: string;
  createdAt: number;
  createdBy: string;
  lastSeenAt?: number;
  /** How many workers this host will seat across all its floors. Declared at pairing (decision 6). */
  seats: number;
  /** Whether an automation hire may seat here. A person may always hire (decision 2). */
  accepting: boolean;
  /** Whether the host owner has agreed to what hosting means (decision 1: no isolation is built). */
  consentedAt?: number;
  revokedAt?: number;
}

interface Saved {
  hosts: Host[];
  codes: PairingCode[];
}

/** Constant-time compare, lifted from the two file-local copies in workers.ts and ptyhost.ts. */
const hashToken = (token: string) => Buffer.from(token, 'utf8').toString('hex');

function cleanHostName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\p{C}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function newCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/**
 * The machines allowed to host floors in this office, in .agent-office/hosts.json.
 *
 * `agent-office hosts` edits the same file while the office runs, so it is re-read when it changes —
 * the same `mtimeMs:size` stamp `Accounts` uses, and the same refusal to write over a file that
 * exists but cannot be read, because that would drop every host on the floor.
 *
 * A pairing code is a one-time bearer: it is exchanged for a token, which is shown to the person
 * pairing exactly once and never stored. Only its hash is kept, so a stolen `hosts.json` admits
 * nobody. The file is written at 0600 for the same reason.
 *
 * Nothing here is a permission. A host may seat anyone in the office onto its own floors (the
 * permission model), and revoking one is immediate because the socket is the unit of trust — dropping
 * the connection kills every floor it carried, in one event.
 *
 * See docs/remote-agents-plan.md.
 */
export class Hosts {
  private data: Saved = { hosts: [], codes: [] };
  private file: string;
  private stamp = '';
  /** The file is there but couldn't be read: never write over it, or every host is gone. */
  private unreadable = false;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'hosts.json');
    this.sync();
  }

  /** The hosts file, when it is there but broken (nothing is saved over it). */
  get unreadableFile(): string {
    this.sync();
    return this.unreadable ? this.file : '';
  }

  private sync() {
    let stamp = '';
    try {
      const st = statSync(this.file);
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      // no hosts yet
    }
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    if (!stamp) {
      this.data = { hosts: [], codes: [] };
      this.unreadable = false;
      return;
    }
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      this.data = {
        hosts: (Array.isArray(saved.hosts) ? saved.hosts : []).filter((h) => h && typeof h.id === 'string'),
        codes: Array.isArray(saved.codes) ? saved.codes : [],
      };
      this.unreadable = false;
    } catch (err) {
      // The last good read is kept, on purpose: a machine that was admitted stays admitted, rather
      // than every hosted floor dropping because someone truncated the file. `save()` refuses to
      // write over it, so nothing new is admitted until it is fixed or moved aside.
      console.error(`agent-office: ${this.file} couldn't be read, so no new machine can be admitted: ${(err as Error).message}`);
      this.unreadable = true;
    }
  }

  private save() {
    if (this.unreadable) {
      console.error(`agent-office: not saving hosts over ${this.file}, which couldn't be read — fix or move it`);
      return;
    }
    // Written whole and renamed into place, so the office and the `hosts` command never read half a file.
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      console.error(`agent-office: couldn't save ${this.file}: ${(err as Error).message}`);
      return;
    }
    try {
      const st = statSync(this.file);
      this.stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      this.stamp = '';
    }
  }

  private dropExpired() {
    const now = Date.now();
    const kept = this.data.codes.filter((c) => c.expiresAt > now);
    if (kept.length !== this.data.codes.length) {
      this.data.codes = kept;
      this.save();
    }
  }

  /** Makes a pairing code. Returns it once: the office shows it and the person types it on the host. */
  pair(by: string): { code: string; expiresAt: number } | string {
    this.sync();
    this.dropExpired();
    if (this.data.hosts.filter((h) => !h.revokedAt).length >= MAX_HOSTS) return `Already ${MAX_HOSTS} machines host floors here`;
    if (this.data.codes.length >= MAX_CODES) return 'Too many pairing codes are open — cancel some first';
    const code = newCode();
    const expiresAt = Date.now() + PAIRING_TTL_MS;
    this.data.codes.push({ code, expiresAt, createdAt: Date.now(), createdBy: by });
    this.save();
    return { code, expiresAt };
  }

  /**
   * Exchanges a code for a token, once. The token is returned to the caller and never stored: only its
   * hash is kept, so a copied hosts.json admits nobody. A revoked host cannot be brought back with a
   * fresh code — revoking is the end of it, which is what makes revocation immediate rather than a
   * thing to undo later.
   */
  claim(raw: unknown, name: unknown, owner?: string, seats = 0): { host: Host; token: string } | string {
    this.sync();
    // The file is there but broken. Machines already admitted keep working off the last good read,
    // but admitting a new one now would mean writing a token over a file we cannot parse — and
    // overwriting it would destroy the record of every machine already admitted.
    if (this.unreadable) return 'The hosts file could not be read, so no machine can be paired until it is fixed';
    this.dropExpired();
    const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    if (!code) return 'No pairing code';
    const found = this.data.codes.find((c) => c.code === code);
    if (!found) return 'That pairing code is not one of ours';
    if (found.expiresAt <= Date.now()) return 'That pairing code has expired';
    const label = cleanHostName(name);
    if (!label) return 'That machine needs a name, so refusals can name it';
    if (this.data.hosts.filter((h) => !h.revokedAt).length >= MAX_HOSTS) return `Already ${MAX_HOSTS} machines host floors here`;
    const token = randomBytes(32).toString('hex');
    const host: Host = {
      id: randomBytes(8).toString('hex'),
      name: label,
      hash: hashToken(token),
      owner: cleanHostName(owner) || undefined,
      createdAt: Date.now(),
      createdBy: found.createdBy,
      seats: Math.max(0, Math.min(SEATS_MAX, Number(seats) || 0)),
      accepting: false,
    };
    this.data.hosts.push(host);
    // One-time: the code is spent whether or not the caller kept the token.
    this.data.codes = this.data.codes.filter((c) => c.code !== code);
    this.save();
    return { host, token };
  }

  /** The host a token belongs to, or undefined. Constant-time, and a revoked host never matches. */
  authenticate(token: string): Host | undefined {
    this.sync();
    if (!token) return undefined;
    const given = hashToken(token);
    // Every host is compared, so a wrong token costs the same whatever the list length.
    let found: Host | undefined;
    for (const h of this.data.hosts) {
      if (safeEq(given, h.hash)) found = h;
    }
    return found && !found.revokedAt ? found : undefined;
  }

  get(id: string): Host | undefined {
    this.sync();
    return this.data.hosts.find((h) => h.id === id);
  }

  list(): Host[] {
    this.sync();
    return this.data.hosts;
  }

  /** Ends it: a revoked host is refused at the next upgrade and cannot be re-claimed. */
  revoke(id: string): Host | string | undefined {
    this.sync();
    const host = this.data.hosts.find((h) => h.id === id);
    if (!host) return 'No such machine';
    if (host.revokedAt) return host;
    host.revokedAt = Date.now();
    this.save();
    return host;
  }

  /** What the host owner may change about their own machine. */
  configure(id: string, patch: { seats?: unknown; accepting?: unknown; name?: unknown; consented?: boolean }): Host | string | undefined {
    this.sync();
    const host = this.data.hosts.find((h) => h.id === id);
    if (!host) return 'No such machine';
    if (host.revokedAt) return 'That machine has been revoked';
    if (patch.name !== undefined) {
      const label = cleanHostName(patch.name);
      if (!label) return 'That machine needs a name, so refusals can name it';
      host.name = label;
    }
    if (patch.seats !== undefined) host.seats = Math.max(0, Math.min(SEATS_MAX, Number(patch.seats) || 0));
    if (patch.accepting !== undefined) host.accepting = patch.accepting === true;
    if (patch.consented === true) host.consentedAt ??= Date.now();
    this.save();
    return host;
  }

  /** Records that a machine is connected, so the office can show it and its refusal can be current. */
  seen(id: string) {
    this.sync();
    const host = this.data.hosts.find((h) => h.id === id);
    if (host && !host.revokedAt) {
      host.lastSeenAt = Date.now();
      this.save();
    }
  }

  /** ⚙️ Settings: what the office shows its people. Never includes a token. */
  state(connected: Map<string, number>): HostState[] {
    this.sync();
    this.dropExpired();
    return this.data.hosts.map(({ hash: _h, ...h }) => ({
      ...h,
      // One socket carries N floors, so "how many floors is this serving" is what is worth showing.
      floors: connected.get(h.id) ?? 0,
      online: connected.has(h.id),
    }));
  }
}

/** How many workers one machine will seat. The office's own limit is checked separately. */
export const SEATS_MAX = 32;

/** The protocol this office speaks, for a host that asks before pairing. */
export { FLOORHOST_PROTOCOL };
