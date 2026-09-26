import { createHmac, timingSafeEqual, randomBytes, scrypt } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const COOKIE_NAME = 'ao_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 5 * 60_000;

export class Auth {
  private attempts = new Map<string, { count: number; resetAt: number }>();
  /** Session signing key. Derived from the password too, so changing the password logs everyone out. */
  private key: Buffer;

  constructor(
    private verifier: Buffer,
    private salt: Buffer,
    secret: string,
  ) {
    this.key = createHmac('sha256', secret).update('session:').update(verifier).digest();
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

  issue(): string {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS, n: randomBytes(8).toString('hex') })).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  verify(token: string | undefined): boolean {
    if (!token) return false;
    const dot = token.indexOf('.');
    if (dot < 1) return false;
    const payload = token.slice(0, dot);
    const sig = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(this.sign(payload));
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return false;
    try {
      const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return typeof exp === 'number' && exp > Date.now();
    } catch {
      return false;
    }
  }

  fromRequest(req: IncomingMessage): boolean {
    return this.verify(parseCookies(req.headers.cookie)[cookieName(req)]);
  }

  cookie(req: IncomingMessage, token: string, secure: boolean): string {
    return `${cookieName(req)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`;
  }

  clearCookie(req: IncomingMessage): string {
    return `${cookieName(req)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}

/** Cookies ignore ports, so offices sharing a host (e.g. SSH tunnels on localhost:4600 and :4601) each get their own. */
function cookieName(req: IncomingMessage): string {
  const port = /:(\d+)$/.exec(req.headers.host ?? '')?.[1];
  return port ? `${COOKIE_NAME}_${port}` : COOKIE_NAME;
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
