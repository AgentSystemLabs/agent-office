import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { officeHome } from './config.js';
import type { AccountInvite, AccountRole, AccountsState } from '../shared/protocol.js';
import { L } from './i18n.js';

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
    if (name && !n) return L.srvAccounts.noLetters;
    if (n) {
      const taken = this.nameTaken(n);
      if (taken) return taken;
    }
    if (this.data.invites.length >= MAX_INVITES) return L.srvAccounts.tooManyInvites;
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
    if (!invite) return L.srvAccounts.expired;
    const n = invite.name ?? cleanName(name);
    if (!n) return L.srvAccounts.pickName;
    if (password.length < PASSWORD_MIN) return L.srvAccounts.shortPassword(PASSWORD_MIN);
    if (password.length > PASSWORD_MAX) return L.srvAccounts.longPassword;
    const salt = randomBytes(16);
    const derived = await hash(password, salt);
    // Hashing took a moment: someone else may have used the link or taken the name meanwhile.
    this.sync();
    const i = this.data.invites.findIndex((v) => v.id === invite.id);
    if (i < 0) return L.srvAccounts.justUsed;
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
    if (this.data.accounts.some((a) => sameName(a.name, n))) return L.srvAccounts.nameTaken(n);
    if (this.data.invites.some((v) => v.id !== exceptInvite && v.name && sameName(v.name, n))) return L.srvAccounts.hasInvite(n);
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
      console.error(`agent-office: ${L.logs.readFailed(this.file, (err as Error).message)}`);
    }
  }

  private save() {
    if (this.unreadable) {
      console.error(`agent-office: ${L.logs.notSaving(this.file)}`);
      return;
    }
    // Written whole and renamed into place, so the office and the `accounts` command never read half a file.
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      console.error(`agent-office: ${L.logs.saveFailed(this.file, (err as Error).message)}`);
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

const HELP = L.accountsCli.help;

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
      if (!argv[i + 1]) return usage(L.accountsCli.dirValue);
      dir = path.resolve(argv[++i]);
    } else if (a === '--admin') admin = true;
    else if (a.startsWith('-')) return usage(L.cli.unknownOption(a));
    else args.push(a);
  }
  const dataDir = path.join(dir, '.agent-office');
  try {
    statSync(dataDir);
  } catch {
    console.error(`agent-office accounts: ${L.accountsCli.noOffice(dir)}`);
    return 1;
  }
  const accounts = new Accounts(dataDir);
  if (accounts.unreadableFile) return fail(L.accountsCli.unreadable(accounts.unreadableFile));
  const [cmd = 'list', arg, arg2] = args;
  switch (cmd) {
    case 'list': {
      const s = accounts.state(new Set());
      console.log(L.accountsCli.shared(s.sharedPassword));
      console.log(`\n${L.accountsCli.accounts(s.accounts.length)}`);
      for (const a of s.accounts) {
        console.log(`  ${a.name.padEnd(NAME_MAX)}  ${a.role.padEnd(6)}  ${L.accountsCli.since(day(a.createdAt))}  ${a.lastSeenAt ? L.accountsCli.lastSeen(day(a.lastSeenAt)) : L.accountsCli.never}`);
      }
      if (!s.accounts.length) console.log(`  ${L.accountsCli.noneYet}`);
      if (s.invites.length) {
        console.log(`\n${L.accountsCli.openInvites(s.invites.length)}`);
        for (const v of s.invites) console.log(`  ${(v.name ?? L.accountsCli.theyPick).padEnd(NAME_MAX)}  ${v.role.padEnd(6)}  ${L.accountsCli.byUntil(v.createdBy, day(v.expiresAt))}  /join#${v.token}`);
      }
      return 0;
    }
    case 'invite': {
      const v = accounts.invite(L.accountsCli.theTerminal, admin ? 'admin' : 'member', arg);
      if (typeof v === 'string') return fail(v);
      console.log(`${L.accountsCli.invite(v.name, v.role)}\n\n  /join#${v.token}\n`);
      console.log(L.accountsCli.openIt(v.token));
      return 0;
    }
    case 'revoke':
    case 'role': {
      if (!arg) return usage(L.accountsCli.needsName(cmd));
      const a = accounts.byName(arg);
      if (!a) return fail(L.accountsCli.noAccount(arg));
      if (cmd === 'revoke') {
        accounts.revoke(a.id);
        console.log(L.accountsCli.revoked(a.name));
        return 0;
      }
      if (arg2 !== 'admin' && arg2 !== 'member') return usage(L.accountsCli.roleTakes);
      accounts.setRole(a.id, arg2);
      console.log(L.accountsCli.isNow(a.name, arg2 === 'admin'));
      return 0;
    }
    case 'password': {
      if (arg !== 'on' && arg !== 'off') return usage(L.accountsCli.passwordTakes);
      if (arg === 'off' && !accounts.state(new Set()).accounts.some((a) => a.role === 'admin')) {
        return fail(L.accountsCli.adminFirst);
      }
      accounts.setSharedPassword(arg === 'on');
      console.log(arg === 'on' ? L.accountsCli.sharedWorks : L.accountsCli.sharedNoLonger);
      return 0;
    }
    default:
      return usage(L.accountsCli.unknownCommand(cmd));
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
