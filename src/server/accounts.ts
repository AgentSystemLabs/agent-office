import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { officeHome } from './config.js';
import type { AccountInvite, AccountRole, AccountsState } from '../shared/protocol.js';

export const NAME_MAX = 24;
export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 512;
const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_INVITES = 100;

export interface Account {
  id: string;
  name: string;
  role: AccountRole;
  /** scrypt(password, salt), hex. */
  hash: string;
  salt: string;
  createdAt: number;
  createdBy: string;
  lastSeenAt?: number;
}

interface Saved {
  accounts: Account[];
  invites: AccountInvite[];
  /** Missing means on: offices from before accounts keep working with their password. */
  sharedPassword?: boolean;
}

/** Collapses whitespace and drops control characters, so "Ada" and " Ada​" are one name. */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\p{C}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

function hash(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, (err, key) => (err ? reject(err) : resolve(key))));
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * Everyone's own sign-in, in .agent-office/accounts.json: named accounts made from single-use
 * invite links, and whether the shared office password still works alongside them.
 * `agent-office accounts` edits the same file while the office runs, so it's re-read when it changes.
 */
export class Accounts {
  private data: Saved = { accounts: [], invites: [] };
  private file: string;
  private stamp = '';
  /** The file is there but couldn't be read: never write over it, or everyone's accounts are gone. */
  private unreadable = false;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'accounts.json');
    this.sync();
  }

  /** The accounts file, when it's there but broken (nothing is saved over it). */
  get unreadableFile(): string | undefined {
    return this.unreadable ? this.file : undefined;
  }

  get sharedPassword(): boolean {
    this.sync();
    return this.data.sharedPassword !== false;
  }

  /** Whether anyone has an account yet. */
  get any(): boolean {
    this.sync();
    return this.data.accounts.length > 0;
  }

  get(id: string | undefined): Account | undefined {
    if (!id) return undefined;
    this.sync();
    return this.data.accounts.find((a) => a.id === id);
  }

  byName(name: string): Account | undefined {
    this.sync();
    const n = cleanName(name);
    return n ? this.data.accounts.find((a) => sameName(a.name, n)) : undefined;
  }

  state(online: Set<string>): AccountsState {
    this.sync();
    this.dropExpired();
    return {
      accounts: this.data.accounts.map(({ hash: _h, salt: _s, ...a }) => ({ ...a, online: online.has(a.id) })),
      invites: this.data.invites,
      sharedPassword: this.data.sharedPassword !== false,
    };
  }

  /** The account for a name and password, or undefined. Takes as long either way. */
  async check(name: string, password: string): Promise<Account | undefined> {
    const a = this.byName(name);
    const pw = password.slice(0, PASSWORD_MAX);
    const derived = await hash(pw, a ? Buffer.from(a.salt, 'hex') : randomBytes(16));
    return a && timingSafeEqual(derived, Buffer.from(a.hash, 'hex')) ? a : undefined;
  }

  invite(by: string, role: AccountRole, name?: string): AccountInvite | string {
    this.sync();
    this.dropExpired();
    const n = cleanName(name);
    if (name && !n) return 'That name has no letters in it';
    if (n) {
      const taken = this.nameTaken(n);
      if (taken) return taken;
    }
    if (this.data.invites.length >= MAX_INVITES) return 'Too many open invites — cancel some first';
    const now = Date.now();
    const invite: AccountInvite = {
      id: randomBytes(5).toString('hex'),
      token: randomBytes(24).toString('base64url'),
      ...(n ? { name: n } : {}),
      role: role === 'admin' ? 'admin' : 'member',
      createdBy: by,
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
    };
    this.data.invites.push(invite);
    this.save();
    return invite;
  }

  cancel(inviteId: string): AccountInvite | undefined {
    this.sync();
    const i = this.data.invites.findIndex((v) => v.id === inviteId);
    if (i < 0) return undefined;
    const [v] = this.data.invites.splice(i, 1);
    this.save();
    return v;
  }

  /** The open invite for a link's token. */
  findInvite(token: string): AccountInvite | undefined {
    this.sync();
    this.dropExpired();
    if (!token) return undefined;
    const want = digest(token);
    return this.data.invites.find((v) => timingSafeEqual(digest(v.token), want));
  }

  /** Uses up an invite: makes the account and returns it, or says what's wrong. */
  async join(token: string, name: string, password: string): Promise<Account | string> {
    const invite = this.findInvite(token);
    if (!invite) return 'This invite link has expired or was already used. Ask for a new one.';
    const n = invite.name ?? cleanName(name);
    if (!n) return 'Pick a name';
    if (password.length < PASSWORD_MIN) return `Pick a password of at least ${PASSWORD_MIN} characters`;
    if (password.length > PASSWORD_MAX) return 'That password is too long';
    const salt = randomBytes(16);
    const derived = await hash(password, salt);
    // Hashing took a moment: someone else may have used the link or taken the name meanwhile.
    this.sync();
    const i = this.data.invites.findIndex((v) => v.id === invite.id);
    if (i < 0) return 'This invite link was just used. Ask for a new one.';
    const taken = this.nameTaken(n, invite.id);
    if (taken) return taken;
    const account: Account = {
      id: randomBytes(8).toString('hex'),
      name: n,
      role: invite.role,
      hash: derived.toString('hex'),
      salt: salt.toString('hex'),
      createdAt: Date.now(),
      createdBy: invite.createdBy,
    };
    this.data.invites.splice(i, 1);
    this.data.accounts.push(account);
    this.save();
    return account;
  }

  /** Deletes an account. Its sessions stop working on their next request. */
  revoke(id: string): Account | undefined {
    this.sync();
    const i = this.data.accounts.findIndex((a) => a.id === id);
    if (i < 0) return undefined;
    const [a] = this.data.accounts.splice(i, 1);
    this.save();
    return a;
  }

  setRole(id: string, role: AccountRole): Account | undefined {
    const a = this.get(id);
    if (!a) return undefined;
    a.role = role === 'admin' ? 'admin' : 'member';
    this.save();
    return a;
  }

  setSharedPassword(on: boolean) {
    this.sync();
    if (on) delete this.data.sharedPassword;
    else this.data.sharedPassword = false;
    this.save();
  }

  seen(id: string) {
    const a = this.get(id);
    if (!a) return;
    a.lastSeenAt = Date.now();
    this.save();
  }

  private nameTaken(n: string, exceptInvite?: string): string | undefined {
    if (this.data.accounts.some((a) => sameName(a.name, n))) return `There's already an account called ${n}`;
    if (this.data.invites.some((v) => v.id !== exceptInvite && v.name && sameName(v.name, n))) return `${n} already has an open invite`;
    return undefined;
  }

  private dropExpired() {
    const now = Date.now();
    const keep = this.data.invites.filter((v) => v.expiresAt > now);
    if (keep.length === this.data.invites.length) return;
    this.data.invites = keep;
    this.save();
  }

  /** Re-reads the file when something else (the `accounts` command) changed it. */
  private sync() {
    let stamp = '';
    try {
      const st = statSync(this.file);
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      // no accounts yet
    }
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    if (!stamp) {
      this.data = { accounts: [], invites: [] };
      this.unreadable = false;
      return;
    }
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      this.data = {
        accounts: Array.isArray(saved.accounts) ? saved.accounts.filter((a) => a && typeof a.id === 'string' && typeof a.hash === 'string') : [],
        invites: Array.isArray(saved.invites) ? saved.invites.filter((v) => v && typeof v.token === 'string') : [],
        ...(saved.sharedPassword === false ? { sharedPassword: false } : {}),
      };
      this.unreadable = false;
    } catch (err) {
      this.unreadable = true;
      console.error(`agent-office: couldn't read ${this.file}: ${(err as Error).message}`);
    }
  }

  private save() {
    if (this.unreadable) {
      console.error(`agent-office: not saving accounts over ${this.file}, which couldn't be read — fix or move it`);
      return;
    }
    // Written whole and renamed into place, so the office and the `accounts` command never read half a file.
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
}

const HELP = `agent-office accounts — who can sign in to the office

Usage:
  agent-office accounts [list]                 Accounts, open invites, and the shared password
  agent-office accounts invite [name] [--admin]
                                               Make a single-use invite link (valid 7 days)
  agent-office accounts revoke <name>          Delete an account; it's signed out at once
  agent-office accounts role <name> admin|member
  agent-office accounts password on|off        Whether the shared office password still works

Options:
  -d, --dir <dir>   The office's directory: the project it was started in, or its
                    home (default: the current directory if an office ran there,
                    else ~/agent-office or $AGENT_OFFICE_HOME)
  -h, --help        Show this help

Works while the office runs: it picks up the changes within seconds.
`;

const day = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

/** `agent-office accounts`: exits 0 when done, 1 when it couldn't, 2 for a usage error. */
export function accountsCommand(argv: string[]): number {
  // An office started in this project keeps its accounts here; one started anywhere else, in its home.
  let dir = existsSync(path.join(process.cwd(), '.agent-office', 'config.json')) ? process.cwd() : officeHome();
  let admin = false;
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      process.stdout.write(HELP);
      return 0;
    } else if (a === '-d' || a === '--dir') {
      if (!argv[i + 1]) return usage('--dir needs a value');
      dir = path.resolve(argv[++i]);
    } else if (a === '--admin') admin = true;
    else if (a.startsWith('-')) return usage(`unknown option ${a}`);
    else args.push(a);
  }
  const dataDir = path.join(dir, '.agent-office');
  try {
    statSync(dataDir);
  } catch {
    console.error(`agent-office accounts: no office has run in ${dir} yet — start it once with \`agent-office\` there`);
    return 1;
  }
  const accounts = new Accounts(dataDir);
  if (accounts.unreadableFile) return fail(`${accounts.unreadableFile} couldn't be read (see above) — fix or move it first`);
  const [cmd = 'list', arg, arg2] = args;
  switch (cmd) {
    case 'list': {
      const s = accounts.state(new Set());
      console.log(`Shared office password: ${s.sharedPassword ? 'on' : 'off'}`);
      console.log(`\nAccounts (${s.accounts.length}):`);
      for (const a of s.accounts) {
        console.log(`  ${a.name.padEnd(NAME_MAX)}  ${a.role.padEnd(6)}  since ${day(a.createdAt)}  ${a.lastSeenAt ? `last seen ${day(a.lastSeenAt)}` : 'never signed in'}`);
      }
      if (!s.accounts.length) console.log('  none yet: `agent-office accounts invite <name> --admin` makes you one');
      if (s.invites.length) {
        console.log(`\nOpen invites (${s.invites.length}):`);
        for (const v of s.invites) console.log(`  ${(v.name ?? '(they pick)').padEnd(NAME_MAX)}  ${v.role.padEnd(6)}  by ${v.createdBy}, until ${day(v.expiresAt)}  /join#${v.token}`);
      }
      return 0;
    }
    case 'invite': {
      const v = accounts.invite('the terminal', admin ? 'admin' : 'member', arg);
      if (typeof v === 'string') return fail(v);
      console.log(`Invite ${v.name ? `for ${v.name} ` : ''}(${v.role}), single use, valid for 7 days:\n\n  /join#${v.token}\n`);
      console.log(`Open it on the office's own address, e.g. http://localhost:4600/join#${v.token}`);
      return 0;
    }
    case 'revoke':
    case 'role': {
      if (!arg) return usage(`${cmd} needs a name`);
      const a = accounts.byName(arg);
      if (!a) return fail(`there's no account called ${arg}`);
      if (cmd === 'revoke') {
        accounts.revoke(a.id);
        console.log(`Revoked ${a.name}'s account. They're signed out of the office within seconds.`);
        return 0;
      }
      if (arg2 !== 'admin' && arg2 !== 'member') return usage('role takes admin or member');
      accounts.setRole(a.id, arg2);
      console.log(`${a.name} is ${arg2 === 'admin' ? 'an admin' : 'a member'} now.`);
      return 0;
    }
    case 'password': {
      if (arg !== 'on' && arg !== 'off') return usage('password takes on or off');
      if (arg === 'off' && !accounts.state(new Set()).accounts.some((a) => a.role === 'admin')) {
        return fail('make an admin account first (`agent-office accounts invite <name> --admin`), or nobody could manage the office');
      }
      accounts.setSharedPassword(arg === 'on');
      console.log(arg === 'on' ? 'The shared office password works again.' : 'The shared office password no longer signs anyone in; people who used it are signed out within seconds.');
      return 0;
    }
    default:
      return usage(`unknown command ${cmd}`);
  }
}

function usage(msg: string): number {
  console.error(`agent-office accounts: ${msg}\n`);
  process.stderr.write(HELP);
  return 2;
}

function fail(msg: string): number {
  console.error(`agent-office accounts: ${msg}`);
  return 1;
}
