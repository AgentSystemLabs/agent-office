import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const COOKIE_NAME = 'ao_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export class Auth {
  private attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private password: string,
    private secret: string,
  ) {}

  checkPassword(candidate: string): boolean {
    const a = createHmac('sha256', this.secret).update(candidate).digest();
    const b = createHmac('sha256', this.secret).update(this.password).digest();
    return timingSafeEqual(a, b);
  }

  /** Returns false when this client has made too many failed attempts recently. */
  allowAttempt(ip: string): boolean {
    const now = Date.now();
    const rec = this.attempts.get(ip);
    if (!rec || rec.resetAt < now) return true;
    return rec.count < 8;
  }

  recordFailure(ip: string) {
    const now = Date.now();
    const rec = this.attempts.get(ip);
    if (!rec || rec.resetAt < now) this.attempts.set(ip, { count: 1, resetAt: now + 5 * 60_000 });
    else rec.count++;
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
    return this.verify(parseCookies(req.headers.cookie)[COOKIE_NAME]);
  }

  cookie(token: string, secure: boolean): string {
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`;
  }

  clearCookie(): string {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
