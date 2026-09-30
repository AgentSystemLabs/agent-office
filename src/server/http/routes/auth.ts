// Signing in and out: the office password, an account's own, an invite link, a claim link, and a
// sign-in link printed in the office's terminal.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { str } from '../../office/input.js';
import { clientIp, isSecure, readBody, send } from '../util.js';
import type { Route } from '../router.js';

const TOO_MANY_ATTEMPTS = 'Too many attempts. Try again in a few minutes.';

/**
 * A password, claim-token or invite guess: counts it against the IP, then reads the small JSON
 * body. Undefined once it has already answered (rate limited, or a bad body).
 */
async function readGuess(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse): Promise<{ ip: string; body: Record<string, unknown> } | undefined> {
  const ip = clientIp(req, ctx.cfg.trustProxy);
  // Counted before the body is read, so parallel guesses can't all slip under the limit.
  if (!ctx.auth.allowAttempt(ip)) return void send(res, 429, { error: TOO_MANY_ATTEMPTS });
  try {
    const body = JSON.parse(await readBody(req, 4096));
    if (body && typeof body === 'object') return { ip, body };
  } catch {
    // answered below
  }
  send(res, 400, { error: 'Bad request' });
}
const signedIn = (ctx: Ctx, req: http.IncomingMessage, accountId?: string) => ({ 'set-cookie': ctx.auth.cookie(req, ctx.auth.issue(accountId), isSecure(req, ctx.cfg)) });

/** With a name, that person's own account; without one, the shared office password (while it's on). */
export async function login(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse) {
  const { accounts, auth } = ctx;
  const guess = await readGuess(ctx, req, res);
  if (!guess) return;
  const name = str(guess.body.name, 64).trim();
  const password = str(guess.body.password, 512);
  if (name) {
    const account = await accounts.check(name, password);
    if (!account) return send(res, 401, { error: 'Wrong name or password' });
    auth.recordSuccess(guess.ip);
    return send(res, 200, { ok: true }, signedIn(ctx, req, account.id));
  }
  if (!accounts.sharedPassword) return send(res, 401, { error: 'Sign in with your name and your own password' });
  if (!(await auth.checkPassword(password))) {
    return send(res, 401, { error: accounts.any ? 'Wrong password. With an account of your own, type your name too.' : 'Wrong password' });
  }
  auth.recordSuccess(guess.ip);
  return send(res, 200, { ok: true }, signedIn(ctx, req));
}
/** Which fields the sign-in forms ask for. */
export const loginOptions = (ctx: Ctx) => ({ accounts: ctx.accounts.any, shared: ctx.accounts.sharedPassword });

/**
 * An invite link: `peek` says who it's for; otherwise it makes the account and signs it in.
 * Counted like a password guess, since the token is one.
 */
async function join(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse) {
  const { accounts, auth } = ctx;
  const guess = await readGuess(ctx, req, res);
  if (!guess) return;
  const token = str(guess.body.token, 128);
  const invite = accounts.findInvite(token);
  if (!invite) return send(res, 410, { error: 'This invite link has expired or was already used. Ask whoever sent it for a new one.' });
  auth.recordSuccess(guess.ip);
  if (guess.body.peek === true) return send(res, 200, { name: invite.name, role: invite.role, by: invite.createdBy, project: ctx.officeName });
  const r = await accounts.join(token, str(guess.body.name, 64), str(guess.body.password, 1024));
  if (typeof r === 'string') return send(res, 400, { error: r });
  console.log(`  ${r.name} joined the office with an invite from ${r.createdBy}`);
  ctx.accountsChanged();
  return send(res, 200, { ok: true, name: r.name }, signedIn(ctx, req, r.id));
}

// One-time reveal of the generated password. After this the plaintext is gone for good.
const claimable = ({ cfg }: Ctx) => !!cfg.claimToken && !cfg.claimed && !!cfg.password;

export const authRoutes = {
  login: { method: 'POST', path: '/api/login', auth: 'public', handle: (ctx, { req, res }) => login(ctx, req, res) },
  loginOptions: { method: 'GET', path: '/api/login', auth: 'public', handle: (ctx, { res }) => send(res, 200, loginOptions(ctx)) },
  join: { method: 'POST', path: '/api/join', auth: 'public', handle: (ctx, { req, res }) => join(ctx, req, res) },
  claimable: { method: 'GET', path: '/api/claim', auth: 'public', handle: (ctx, { res }) => send(res, 200, { claimable: claimable(ctx) }) },
  claim: {
    method: 'POST',
    path: '/api/claim',
    auth: 'public',
    async handle(ctx, { req, res }) {
      const { cfg, auth } = ctx;
      const guess = await readGuess(ctx, req, res);
      if (!guess) return;
      if (!claimable(ctx)) return send(res, 410, { error: 'This office has already been claimed. Sign in with the password you saved.' });
      if (!auth.checkToken(str(guess.body.token, 256), cfg.claimToken!)) return send(res, 403, { error: 'That claim link is not valid.' });
      const password = cfg.password!;
      cfg.markClaimed();
      auth.recordSuccess(guess.ip);
      console.log('  the office password was claimed — it will not be shown again');
      return send(res, 200, { password }, signedIn(ctx, req));
    },
  },
  // A sign-in link the office printed in its terminal (/login#key=…), traded for a session once.
  link: {
    method: 'POST',
    path: '/api/link',
    auth: 'public',
    async handle(ctx, { req, res }) {
      const guess = await readGuess(ctx, req, res);
      if (!guess) return;
      if (!ctx.accounts.sharedPassword || !ctx.auth.useLinkKey(str(guess.body.key, 128))) {
        return send(res, 410, { error: 'That sign-in link was already used. Sign in with the office password.' });
      }
      ctx.auth.recordSuccess(guess.ip);
      return send(res, 200, { ok: true }, signedIn(ctx, req));
    },
  },
  logout: { method: 'POST', path: '/api/logout', auth: 'public', handle: (ctx, { req, res }) => send(res, 200, { ok: true }, { 'set-cookie': ctx.auth.clearCookie(req) }) },
  whoami: { path: '/api/whoami', auth: 'session', handle: (ctx, { res, session }) => send(res, 200, { ok: true, me: ctx.meOf(session.account?.id) }) },
} satisfies Record<string, Route>;
