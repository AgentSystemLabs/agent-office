// DeepAI Code, reached the way the app itself offers: its MCP endpoint, over OAuth.
//
// The app's model transport is closed to anything it didn't start (a capability it mints per run,
// see the note in ./deepai.ts), but its orchestration is not: the app publishes an OAuth 2.1
// authorization server for MCP clients (/.well-known/oauth-authorization-server), an admin approves
// a pairing code once, and the office gets a 30-day bearer scoped to orchestration:read/operate.
// With it the office asks the app to run a turn in a workspace — including a worktree the office
// made — and reads the transcript back. There is no child process: the app is the runtime.
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Where the app's MCP listens when the desktop app runs on this machine. */
export const DEEPAI_MCP_URL = 'http://127.0.0.1:3774/mcp';

/** The protocol revision the app speaks (and expects in a header on every call after initialize). */
export const DEEPAI_MCP_PROTOCOL = '2025-06-18';

/** What the app issued for this office: a bearer, and when it stops working. */
export interface DeepaiCredential {
  /** The bearer the app minted once a pairing was approved. */
  token: string;
  /** ISO time it stops working: the app issues thirty days, and pairing again is one click. */
  expiresAt: string;
  /** The client the app registered for the office (dynamic client registration). */
  clientId: string;
  /** Where the app sends the code back: a loopback listener the office opens for the pairing. */
  redirectUri: string;
  /** The MCP endpoint it was issued for. */
  url: string;
}

/** The file the credential lives in, on a floor's data directory. */
export function deepaiCredentialFile(dataDir: string): string {
  return path.join(dataDir, 'deepai-mcp.json');
}

/** The credential stored on this floor, when there is one that still works. */
export function readDeepaiCredential(dataDir: string, now: Date = new Date()): DeepaiCredential | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(deepaiCredentialFile(dataDir), 'utf8'));
  } catch {
    return undefined;
  }
  const c = parsed as Partial<DeepaiCredential>;
  if (typeof c?.token !== 'string' || !c.token.trim()) return undefined;
  if (typeof c.expiresAt !== 'string' || !(Date.parse(c.expiresAt) > now.getTime())) return undefined;
  return {
    token: c.token,
    expiresAt: c.expiresAt,
    clientId: typeof c.clientId === 'string' ? c.clientId : '',
    redirectUri: typeof c.redirectUri === 'string' ? c.redirectUri : '',
    url: typeof c.url === 'string' && c.url.trim() ? c.url : DEEPAI_MCP_URL,
  };
}

/** Stores the credential where only this user reads it. */
export function writeDeepaiCredential(dataDir: string, credential: DeepaiCredential): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = deepaiCredentialFile(dataDir);
  writeFileSync(file, `${JSON.stringify(credential, null, 2)}\n`, { mode: 0o600 });
}

/** A PKCE verifier and the challenge the authorize request carries (S256, as the app asks). */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Where the office's loopback listener answers the app's redirect. */
export function loopbackRedirect(port: number): string {
  return `http://127.0.0.1:${port}/deepai/callback`;
}

/** Registers the office as an MCP client and returns the id the app gave it. */
export async function registerDeepaiClient(input: {
  url: string;
  redirectUri: string;
  name?: string;
  fetch?: typeof fetch;
}): Promise<string> {
  const base = origin(input.url);
  const res = await (input.fetch ?? fetch)(`${base}/oauth/mcp/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: input.name ?? 'agent-office',
      redirect_uris: [input.redirectUri],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'orchestration:read orchestration:operate',
    }),
  });
  if (!res.ok) throw new Error(`DeepAI Code refused the client registration (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { client_id?: unknown };
  if (typeof body.client_id !== 'string' || !body.client_id) throw new Error('DeepAI Code registered the client without an id');
  return body.client_id;
}

/** The page an admin approves: it asks for the pairing code the app prints. */
export function deepaiAuthorizeUrl(input: { url: string; clientId: string; redirectUri: string; challenge: string; state: string }): string {
  const url = new URL('/oauth/mcp/authorize', origin(input.url));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', 'orchestration:read orchestration:operate');
  url.searchParams.set('code_challenge', input.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', input.state);
  return url.toString();
}

/** Trades the approved code for the bearer the office keeps, for as long as the app says. */
export async function exchangeDeepaiCode(input: {
  url: string;
  code: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
  now?: Date;
  fetch?: typeof fetch;
}): Promise<DeepaiCredential> {
  const base = origin(input.url);
  const res = await (input.fetch ?? fetch)(`${base}/oauth/mcp/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      client_id: input.clientId,
      code_verifier: input.verifier,
      redirect_uri: input.redirectUri,
    }).toString(),
  });
  if (!res.ok) throw new Error(`DeepAI Code refused the code (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== 'string' || !body.access_token) throw new Error('DeepAI Code exchanged the code without a token');
  const seconds = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 30 * 24 * 3600;
  const now = input.now ?? new Date();
  return {
    token: body.access_token,
    expiresAt: new Date(now.getTime() + seconds * 1000).toISOString(),
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    url: input.url,
  };
}

/** The app's own origin, from an MCP endpoint (http://host:port/mcp → http://host:port). */
function origin(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

/** A tool call the app answered with an error (its own code, not a transport failure). */
export class DeepaiMcpError extends Error {
  constructor(
    readonly tool: string,
    message: string,
  ) {
    super(`${tool}: ${message}`);
    this.name = 'DeepaiMcpError';
  }
}

/**
 * The app's MCP endpoint as a client: initialize once, keep the session the app hands out, then call
 * tools. Answers arrive as JSON or as an SSE stream, and every call after initialize says which
 * protocol revision it speaks.
 */
export class DeepaiMcp {
  private sessionId?: string;
  private ready?: Promise<void>;
  private id = 0;

  constructor(
    private readonly input: { url: string; token: string; fetch?: typeof fetch },
  ) {}

  /** The tools the credential may call (88, with orchestration:read/operate). */
  async listTools(): Promise<{ name: string; description?: string }[]> {
    const result = await this.rpc<{ tools?: { name: string; description?: string }[] }>('tools/list', {});
    return result?.tools ?? [];
  }

  /**
   * Calls one tool. What the app returns as text is parsed as JSON when it is JSON (its tools answer
   * with objects), so callers read fields instead of strings; an `isError` answer throws.
   */
  async call<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await this.rpc<{ content?: { type: string; text?: string }[]; isError?: boolean }>('tools/call', { name, arguments: args });
    const text = (result?.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('\n');
    if (result?.isError) {
      let message = text;
      try {
        const parsed = JSON.parse(text) as { message?: unknown };
        if (typeof parsed?.message === 'string') message = parsed.message;
      } catch {
        // Not JSON: the text is the message.
      }
      throw new DeepaiMcpError(name, message.slice(0, 500));
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  /** Initializes on first use, and not again: the session the app hands out lasts as long as we do. */
  private async start(): Promise<void> {
    if (!this.ready) {
      this.ready = this.rpc('initialize', {
        protocolVersion: DEEPAI_MCP_PROTOCOL,
        capabilities: {},
        clientInfo: { name: 'agent-office', version: '1' },
      }, true).then(() => undefined);
      this.ready.catch(() => {
        this.ready = undefined;
      });
    }
    return this.ready;
  }

  private async rpc<T = unknown>(method: string, params: unknown, handshake = false): Promise<T> {
    if (!handshake) await this.start();
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.input.token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': DEEPAI_MCP_PROTOCOL,
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    const res = await (this.input.fetch ?? fetch)(this.input.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
    });
    const session = res.headers?.get?.('mcp-session-id');
    if (session) this.sessionId = session;
    if (!res.ok) throw new Error(`DeepAI Code MCP answered ${res.status}${res.status === 401 ? ' (the pairing is expired: pair again)' : ''}`);
    const text = await res.text();
    const payload = parseRpc(text);
    if (payload?.error) throw new Error(`DeepAI Code MCP refused ${method}: ${JSON.stringify(payload.error).slice(0, 200)}`);
    return (payload?.result ?? undefined) as T;
  }
}

/** A JSON-RPC answer, from a plain body or from the last event of an SSE stream. */
function parseRpc(text: string): { result?: unknown; error?: unknown } | undefined {
  const body = text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6))
    .join('') || text;
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        // Keep looking: an SSE stream can carry events before the answer.
      }
    }
    return undefined;
  }
}
