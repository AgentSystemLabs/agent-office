import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HostState, PairingCode } from '../shared/protocol.js';
import { FLOORHOST_PROTOCOL } from '../shared/floorhost.js';
import { normalizeRepo } from '../shared/floors.js';
import { safeEq } from './secrets.js';
import { Building } from './building.js';
import { officeHome } from './config.js';

/**
 * Joins a path the way the **machine it is on** writes them, which may not be this kind of machine.
 *
 * `C:\work` and `/home/alice/work` are both real answers from a host, and joining the first with `/`
 * happens to work on Windows but reads as a mistake in a config file someone has to fix later. The
 * separator is decided by what the path already looks like, which is the only evidence there is.
 */
function joinOn(projectsDir: string, ...parts: string[]): string {
  const sep = /^[a-zA-Z]:[\\/]/.test(projectsDir) || projectsDir.includes('\\') ? '\\' : '/';
  return [projectsDir.replace(/[\\/]+$/, ''), ...parts].join(sep);
}

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
  /**
   * Where that machine says it keeps its checkouts, as of its last connection.
   *
   * Only ever a suggestion: `agent-office hosts add-floor` uses it to name a path on that machine
   * without anyone having to know its layout, and it is never opened here. Kept on the record rather
   * than fetched, because the CLI that needs it runs while the office may not even be up.
   */
  projectsDir?: string;
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

  /**
   * What a machine said about itself when it announced a floor: currently only where it keeps its
   * checkouts. A hint for `hosts add-floor` and nothing else — the office never reads the path, and a
   * machine that says nothing simply leaves it unset, which is honest rather than a guess.
   */
  declare(id: string, said: { projectsDir?: unknown }) {
    this.sync();
    const host = this.data.hosts.find((h) => h.id === id);
    if (!host || host.revokedAt) return;
    const dir = typeof said.projectsDir === 'string' ? said.projectsDir.trim().slice(0, 400) : '';
    if (!dir || dir === host.projectsDir) return;
    host.projectsDir = dir;
    this.save();
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

const HOSTS_HELP = `Usage: agent-office hosts <command> [options]

The machines allowed to host floors in this office. A machine pairs once with a code, and is then
admitted until it is revoked. Its token is shown once, at pairing, and never stored.

Commands:
  list                        the machines allowed to host floors here, and whether each is connected
  pair [--name <name>]        make a pairing code (single use, 30 minutes). --name pre-labels the machine
  revoke <id|name>            end it: the machine is refused at the next connection, and cannot be re-claimed
  seats <id|name> <n>         how many workers that machine will seat across all its floors
  accept <id|name> <on|off>   whether an automation hire may seat there. A person may always hire.
  add-floor <id|name> <repo>  put a floor on that machine, with the checkout it already has there
  rm-floor <floor>            take a floor off the building (by id, or by owner/name)

Options:
  -d, --dir <path>            the office's directory (default: the office in this folder, or ~/agent-office)
  --checkout <path>           add-floor: where the checkout is **on that machine**. Defaults to the
                              machine's own projects folder when it has reported one
  --floor <name>              add-floor: what to call the floor (default: the repository's name)

A pairing code is read by the person on the other machine. Only its holder can claim it, and it is
spent whether or not they keep the token.

\`add-floor\` writes the building, not the office: floors.json is read when the office starts, so
restart it to see the floor. It does not clone anything and does not check that the path exists —
the checkout is on that machine, and the machine is the one that finds out whether it is really
there (it says so, by name, when it connects).`;

/** `agent-office hosts` — the same file the office reads, edited while it runs (see hosts.ts). */
export function hostsCommand(argv: string[]): number {
  const fail = (msg: string) => {
    console.error(`agent-office hosts: ${msg}`);
    return 1;
  };
  let dir = existsSync(path.join(process.cwd(), '.agent-office', 'config.json')) ? process.cwd() : officeHome();
  let name: string | undefined;
  let checkout: string | undefined;
  let floorName: string | undefined;
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(HOSTS_HELP);
      return 0;
    } else if (a === '-d' || a === '--dir') {
      if (!argv[i + 1]) return fail('--dir needs a value');
      dir = path.resolve(argv[++i]);
    } else if (a === '--name') {
      if (!argv[i + 1]) return fail('--name needs a value');
      name = argv[++i];
    } else if (a === '--checkout') {
      if (!argv[i + 1]) return fail('--checkout needs a value');
      checkout = argv[++i];
    } else if (a === '--floor') {
      if (!argv[i + 1]) return fail('--floor needs a value');
      floorName = argv[++i];
    } else if (a.startsWith('-')) return fail(`unknown option ${a}`);
    else args.push(a);
  }
  const dataDir = path.join(dir, '.agent-office');
  try {
    statSync(dataDir);
  } catch {
    return fail(`no office has run in ${dir} yet — start it once with \`agent-office\` there`);
  }
  const hosts = new Hosts(dataDir);
  if (hosts.unreadableFile) return fail(`${hosts.unreadableFile} couldn't be read (see above) — fix or move it first`);
  const [cmd = 'list', arg, arg2] = args;
  // The building, read from the same file the office reads. Only ever used to add or take off a floor:
  // nothing here clones, and nothing here looks inside a checkout — a hosted floor's is not this
  // machine's to open.
  const building = new Building(dataDir, dir);
  const by = process.env.USER || process.env.USERNAME || 'the office';
  const find = (which: string | undefined) => {
    if (!which) return undefined;
    return hosts.list().find((h) => h.id === which || h.name.toLowerCase() === which.toLowerCase());
  };
  /** How many floors the building puts on each machine, for `list`. */
  const floorsOn = (hostId: string) => building.list().filter((d) => d.host === hostId);
  switch (cmd) {
    case 'list': {
      const list = hosts.list();
      const live = list.filter((h) => !h.revokedAt);
      console.log(`Machines that may host floors here (${live.length}):`);
      for (const h of list) {
        const state = h.revokedAt ? 'revoked' : h.lastSeenAt ? `last seen ${new Date(h.lastSeenAt).toISOString().slice(0, 16).replace('T', ' ')}` : 'never connected';
        console.log(`  ${h.id}  ${h.name.padEnd(24)}  ${String(h.seats).padStart(2)} seats  ${h.accepting ? 'accepting' : 'people only'}  ${state}`);
        if (h.owner) console.log(`              ${h.owner}'s machine${h.consentedAt ? '' : ' — has not confirmed what hosting it means'}`);
        for (const f of floorsOn(h.id)) console.log(`              🛗 ${f.name}  (${f.repo ?? '—'})  at ${f.dir}`);
      }
      if (!live.length) console.log('  none yet: `agent-office hosts pair` makes a code for someone to claim');
      return 0;
    }
    case 'pair': {
      const made = hosts.pair('the terminal');
      if (typeof made === 'string') return fail(made);
      console.log(`Pairing code${name ? ` for ${name}` : ''}, single use, valid for 30 minutes:\n\n  ${made.code}\n`);
      console.log('Give it to whoever is hosting a floor. On their machine, pointed at this office:\n');
      console.log(`  agent-office floor-host --office <this office's address>${name ? ` --name "${name}"` : ''} --code ${made.code}\n`);
      console.log(`The address is whatever reaches this office: ws://localhost:4600 here, or the tunnel's host if it is behind one.`);
      console.log(`Floors are served by whoever added them to the building with \`agent-office hosts\` in mind — this machine only answers.\n`);
      return 0;
    }
    case 'revoke': {
      const host = find(arg);
      if (!host) return fail(arg ? `there's no machine called ${arg}` : 'revoke needs a machine');
      const r = hosts.revoke(host.id);
      if (typeof r === 'string') return fail(r);
      console.log(`Revoked ${host.name}. Its floors go offline at once, and it cannot be paired again — a new code makes a new machine.`);
      return 0;
    }
    case 'seats': {
      const host = find(arg);
      if (!host) return fail(arg ? `there's no machine called ${arg}` : 'seats needs a machine and a number');
      const n = Number(arg2);
      if (!Number.isInteger(n) || n < 0) return fail('seats takes a whole number, 0 or more');
      const r = hosts.configure(host.id, { seats: n });
      if (typeof r === 'string' || !r) return fail(typeof r === 'string' ? r : 'that machine is gone');
      console.log(`${host.name} will seat ${r.seats} worker${r.seats === 1 ? '' : 's'}.`);
      return 0;
    }
    case 'accept': {
      const host = find(arg);
      if (!host) return fail(arg ? `there's no machine called ${arg}` : 'accept needs a machine and on or off');
      if (arg2 !== 'on' && arg2 !== 'off') return fail('accept takes on or off');
      const r = hosts.configure(host.id, { accepting: arg2 === 'on' });
      if (typeof r === 'string' || !r) return fail(typeof r === 'string' ? r : 'that machine is gone');
      console.log(
        r.accepting
          ? `${host.name} is accepting: a queue task or board agent may hire there. People always could.`
          : `${host.name} is people-only: a queue task or board agent will not hire there. People still can.`,
      );
      return 0;
    }
    case 'add-floor': {
      const host = find(arg);
      if (!host) return fail(arg ? `there's no machine called ${arg}` : 'add-floor needs a machine, then a repository');
      if (host.revokedAt) return fail(`${host.name} has been revoked — pair it again to put a floor on it`);
      if (!arg2) return fail('add-floor needs a repository as owner/name');
      const repo = normalizeRepo(arg2);
      if (!repo) return fail(`${arg2} is not owner/name`);
      // Where the checkout is on *that* machine. The office cannot look, and cannot invent it either,
      // so it asks the machine — and only falls back to asking the person when the machine has never
      // said where its projects live.
      const dir = checkout?.trim() || (host.projectsDir ? joinOn(host.projectsDir, ...repo.split('/')) : '');
      if (!dir) {
        return fail(
          `${host.name} hasn't said where it keeps its checkouts yet, so pass --checkout <path on that machine>.\n` +
            `  It reports that the first time it connects: run \`agent-office floor-host\` there, then try again.`,
        );
      }
      const def = building.addHosted({ repo, dir, host: host.id, name: floorName }, by);
      if (typeof def === 'string') return fail(def);
      console.log(`${repo} is a floor on ${host.name}, at ${dir} — on that machine.`);
      if (!checkout) console.log(`(that path came from what ${host.name} reported; pass --checkout to say otherwise)`);
      console.log(`\nRestart the office to see it: floors.json is read when it starts.`);
      console.log(`Its checkout is not checked here — ${host.name} opens it when it connects, and says so if it is not there.`);
      return 0;
    }
    case 'rm-floor': {
      const def = arg ? building.list().find((d) => d.id === arg || (d.repo && d.repo.toLowerCase() === arg.toLowerCase())) : undefined;
      if (!def) return fail(arg ? `no floor called ${arg} here — \`hosts list\` shows the ones on each machine` : 'rm-floor needs a floor, by id or owner/name');
      if (!def.host) return fail('That floor runs on the office machine — remove it from the elevator');
      const where = def.host ? ` on ${find(def.host)?.name ?? def.host}` : '';
      const removed = building.remove(def.id, by);
      if (typeof removed === 'string') return fail(removed);
      console.log(`Took the ${removed.name} floor off the building${where}.`);
      console.log(def.host ? `Its checkout stays where it is, on that machine.` : `Its checkout stays where it is: ${removed.dir}`);
      console.log(`\nRestart the office to see it gone: floors.json is read when it starts.`);
      return 0;
    }
    default:
      return fail(`there's no \`${cmd}\` — try \`agent-office hosts --help\``);
  }
}
