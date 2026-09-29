import { createHash, createHmac, timingSafeEqual, randomBytes, scrypt } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Account, Accounts } from './accounts.js';

export const COOKIE_NAME = 'ao_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 5 * 60_000;
/** Sign-in links not used yet; making one more forgets the oldest. */
const MAX_LINKS = 8;

/** A signed-in browser: with its own account, or (no account) with the shared office password. */
export interface Session {
  account?: Account;
}

export class Auth {
  private attempts = new Map<string, { count: number; resetAt: number }>();
  /** Hashes of the one-time sign-in links' keys that haven't been used yet. */
  private links = new Set<string>();
  /** Signs shared-password sessions. Derived from the password too, so changing it logs those out. */
  private key: Buffer;
  /** Signs account sessions, which outlive a change of the shared password. */
  private accountKey: Buffer;

  constructor(
    private verifier: Buffer,
    private salt: Buffer,
    secret: string,
    private accounts: Accounts,
  ) {
    this.key = createHmac('sha256', secret).update('session:').update(verifier).digest();
    this.accountKey = createHmac('sha256', secret).update('account-session:').digest();
  }

  /** scrypt runs on the libuv pool, so guessing can't stall the event loop. */
  checkPassword(candidate: string): Promise<boolean> {
    return new Promise((resolve) => {
      scrypt(candidate, this.salt, 32, (err, derived) => resolve(!err && timingSafeEqual(derived, this.verifier)));
    });
  }

  checkToken(candidate: string, expected: string): boolean {
    const a = createHmac('sha256', this.key).update(candidate).digest();
    const b = createHmac('sha256', this.key).update(expected).digest();
    return timingSafeEqual(a, b);
  }

  /** Counts a login attempt; returns false once this client has used up its window. */
  allowAttempt(ip: string): boolean {
    const now = Date.now();
    if (this.attempts.size > 10_000) {
      for (const [k, v] of this.attempts) if (v.resetAt < now) this.attempts.delete(k);
    }
    const rec = this.attempts.get(ip);
    if (!rec || rec.resetAt < now) {
      this.attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
      return true;
    }
    rec.count++;
    return rec.count <= MAX_ATTEMPTS;
  }

  recordSuccess(ip: string) {
    this.attempts.delete(ip);
  }

  /**
   * The key of a sign-in link that works once, for whoever started the office in a terminal: it
   * signs in like the shared password. Only its hash is kept, in memory, so a restart forgets it.
   */
  linkKey(): string {
    const key = randomBytes(24).toString('base64url');
    if (this.links.size >= MAX_LINKS) this.links.delete(this.links.values().next().value!);
    this.links.add(linkHash(key));
    return key;
  }

  /** Uses up a sign-in link: true the first time its key is given, never again. */
  useLinkKey(key: string): boolean {
    return !!key && this.links.delete(linkHash(key));
  }

  /** A session cookie's value: for that account, or for the shared password when there's none. */
  issue(accountId?: string): string {
    const body = { exp: Date.now() + SESSION_TTL_MS, n: randomBytes(8).toString('hex'), ...(accountId ? { u: accountId } : {}) };
    const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
    return `${payload}.${this.sign(payload, !!accountId)}`;
  }

  /**
   * Who a cookie signs in, if anyone. A revoked account, or the shared password once it's switched
   * off, stops working at once, whatever the cookie's expiry says.
   */
  verify(token: string | undefined): Session | undefined {
    if (!token) return undefined;
    const dot = token.indexOf('.');
    if (dot < 1) return undefined;
    const payload = token.slice(0, dot);
    let body: { exp?: unknown; u?: unknown };
    try {
      body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return undefined;
    }
    const accountId = typeof body?.u === 'string' ? body.u : undefined;
    const sig = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(this.sign(payload, !!accountId));
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return undefined;
    if (typeof body.exp !== 'number' || body.exp <= Date.now()) return undefined;
    if (!accountId) return this.accounts.sharedPassword ? {} : undefined;
    const account = this.accounts.get(accountId);
    return account ? { account } : undefined;
  }

  fromRequest(req: IncomingMessage): Session | undefined {
    return this.verify(parseCookies(req.headers.cookie)[cookieName(req)]);
  }

  /**
   * Signed in to this office on any port of this host. A service tunnel (localhost:5173) carries
   * the cookie you got on the office's own tunnel (localhost:4600), since cookies ignore ports.
   */
  fromAnyCookie(req: IncomingMessage): boolean {
    for (const [name, value] of Object.entries(parseCookies(req.headers.cookie))) {
      if (OFFICE_COOKIE.test(name) && this.verify(value)) return true;
    }
    return false;
  }

  cookie(req: IncomingMessage, token: string, secure: boolean): string {
    return `${cookieName(req)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`;
  }

  clearCookie(req: IncomingMessage): string {
    return `${cookieName(req)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  private sign(payload: string, account: boolean): string {
    return createHmac('sha256', account ? this.accountKey : this.key).update(payload).digest('base64url');
  }
}

const linkHash = (key: string) => createHash('sha256').update(key).digest('hex');

/** Cookies ignore ports, so offices sharing a host (e.g. SSH tunnels on localhost:4600 and :4601) each get their own. */
function cookieName(req: IncomingMessage): string {
  const port = /:(\d+)$/.exec(req.headers.host ?? '')?.[1];
  return port ? `${COOKIE_NAME}_${port}` : COOKIE_NAME;
}

const OFFICE_COOKIE = new RegExp(`^${COOKIE_NAME}(?:_\\d+)?$`);

/** The Cookie header without the office's session cookies, for passing on to someone else's server. */
export function withoutOfficeCookies(header: string | undefined): string | undefined {
  if (!header) return header;
  const kept = header
    .split(';')
    .filter((part) => !OFFICE_COOKIE.test(part.split('=', 1)[0].trim()))
    .join(';')
    .trim();
  return kept || undefined;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const raw = part.slice(i + 1).trim();
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(raw);
    } catch {
      out[part.slice(0, i).trim()] = raw; // someone else's malformed cookie must not take us down
    }
  }
  return out;
}
