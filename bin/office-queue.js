#!/usr/bin/env node
// office-queue: the task queue from inside Agent Office, for the agents standing by the boards (see
// src/server/stations.ts). The office puts it on their PATH and gives them their own address and token
// in AGENT_OFFICE_HOOK_URL, AGENT_OFFICE_WORKER_ID and AGENT_OFFICE_HOOK_TOKEN; this talks to the
// /office/queue endpoint with them. Plain Node, no build step, no dependencies.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage:
  office-queue list                                  what's on the queue: id, status, title, worker, PR
  office-queue add --title "…" [--issue 12] <<'EOF'  add a task, its prompt on stdin (or --prompt "…");
  …the prompt…                                       prints the new task's id
  EOF
  office-queue remove <id>                           take a waiting task off`;

/** A mistake in how the command was called: the usage is shown with it. */
export class UsageError extends Error {}

const ENV = ['AGENT_OFFICE_HOOK_URL', 'AGENT_OFFICE_WORKER_ID', 'AGENT_OFFICE_HOOK_TOKEN'];
/** How long the office may take to come back when it's restarting (a dev reload, an upgrade). */
const RETRY_MS = 6000;
const TIMEOUT_MS = 15_000;

/**
 * What the command line asks for:
 * { cmd: 'help' } | { cmd: 'list' } | { cmd: 'add', title, issue?, prompt? } | { cmd: 'remove', id }.
 * @param {string[]} argv the arguments after the command's name
 */
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const help = (a) => a === '-h' || a === '--help';
  if (cmd === undefined || cmd === 'help' || help(cmd) || help(rest[0])) return { cmd: 'help' };
  if (cmd === 'list' || cmd === 'ls') {
    if (rest.length) throw new UsageError(`list takes no arguments (got ${rest.join(' ')})`);
    return { cmd: 'list' };
  }
  if (cmd === 'remove' || cmd === 'rm') {
    if (rest.length !== 1 || rest[0].startsWith('-')) throw new UsageError('remove takes one task id, e.g. office-queue remove 3f9c2a1b7d4e');
    return { cmd: 'remove', id: rest[0] };
  }
  if (cmd !== 'add') throw new UsageError(`Unknown command: ${cmd}`);
  /** @type {{ cmd: 'add', title?: string, issue?: number, prompt?: string }} */
  const out = { cmd: 'add' };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const eq = arg.indexOf('=');
    const flag = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg;
    if (flag !== '--title' && flag !== '--issue' && flag !== '--prompt') {
      throw new UsageError(arg.startsWith('-') ? `Unknown option for add: ${flag}` : `Unexpected argument: ${arg} (quote the title, and give the prompt on stdin or with --prompt)`);
    }
    let value;
    if (flag !== arg) value = arg.slice(eq + 1);
    else if (i + 1 < rest.length) value = rest[++i];
    else throw new UsageError(`${flag} needs a value`);
    if (flag === '--title') out.title = value.trim();
    else if (flag === '--prompt') out.prompt = value;
    else {
      const n = /^#?(\d+)$/.exec(value.trim());
      if (!n || Number(n[1]) < 1) throw new UsageError(`--issue takes an issue number, e.g. --issue 12 (got ${value})`);
      out.issue = Number(n[1]);
    }
  }
  if (!out.title) throw new UsageError('Give the task a --title, e.g. office-queue add --title "Fix the login redirect"');
  return out;
}

/**
 * The office's address and this agent's name and token, from the environment.
 * @param {Record<string, string | undefined>} env
 */
export function officeEnv(env) {
  const missing = ENV.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(
      `${missing.join(', ')} ${missing.length === 1 ? "isn't" : "aren't"} set. office-queue only works inside Agent Office, ` +
        'from the terminal of an agent standing by one of the boards.',
    );
  }
  return { url: env.AGENT_OFFICE_HOOK_URL.replace(/\/+$/, ''), worker: env.AGENT_OFFICE_WORKER_ID, token: env.AGENT_OFFICE_HOOK_TOKEN };
}

/**
 * The HTTP request for a parsed command (anything but help). `prompt` is the task's prompt for an add
 * that didn't give --prompt: what came in on stdin.
 * @param {ReturnType<typeof parseArgs>} cmd
 * @param {{ url: string, worker: string, token: string }} office
 * @param {string} [prompt]
 * @returns {{ method: string, url: string, headers: Record<string, string>, body?: string }}
 */
export function buildRequest(cmd, office, prompt) {
  const url = new URL(`${office.url}/office/queue`);
  url.searchParams.set('worker', office.worker);
  const headers = { authorization: `Bearer ${office.token}` };
  if (cmd.cmd === 'list') return { method: 'GET', url: url.href, headers };
  if (cmd.cmd === 'remove') {
    url.searchParams.set('task', cmd.id);
    return { method: 'DELETE', url: url.href, headers };
  }
  if (cmd.cmd !== 'add') throw new Error(`No request for ${cmd.cmd}`);
  const text = (cmd.prompt ?? prompt ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) {
    throw new UsageError(`The task needs a prompt: pipe it in (office-queue add --title "…" <<'EOF' … EOF) or pass --prompt "…"`);
  }
  const body = { title: cmd.title, prompt: text, ...(cmd.issue !== undefined ? { issue: cmd.issue } : {}) };
  return { method: 'POST', url: url.href, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

/**
 * The queue as the office returns it, one line per task.
 * @param {{ maxWorkers?: number, tasks?: Array<Record<string, any>> }} view
 */
export function formatQueue(view) {
  const tasks = view?.tasks ?? [];
  const limit = typeof view?.maxWorkers === 'number' ? ` · up to ${view.maxWorkers} at a time` : '';
  if (!tasks.length) return `The queue is empty${limit}.`;
  const lines = [`${tasks.length} task${tasks.length === 1 ? '' : 's'}${limit}`];
  const status = (t) => (t.status === 'done' && t.outcome && t.outcome !== 'done' ? `done (${t.outcome})` : String(t.status ?? '?'));
  const width = Math.max(...tasks.map((t) => status(t).length));
  for (const t of tasks) {
    const parts = [`${t.title ?? ''}${t.issue ? ` (issue #${t.issue})` : ''}`];
    if (t.worker) parts.push(`worker ${t.worker}${t.branch ? ` on ${t.branch}` : ''}`);
    if (t.pr) parts.push(`PR #${t.pr.number}${t.pr.state ? ` ${String(t.pr.state).toLowerCase()}` : ''} ${t.pr.url}`);
    if (t.error) parts.push(`error: ${t.error}`);
    lines.push(`${t.id}  ${status(t).padEnd(width)}  ${parts.join(' · ')}`);
  }
  return lines.join('\n');
}

/** Why the office turned a request down, in words. */
export function refusal(status, body) {
  const said = body && typeof body.error === 'string' ? body.error : '';
  if (status === 401) return `The office didn't accept this agent's token (401)${said ? `: ${said}` : ''}. Is this the terminal of a board agent that's still running?`;
  if (status === 403) return `The office said no (403): ${said || 'only the agents standing by the boards can use the queue'}.`;
  return `The office said no (${status})${said ? `: ${said}` : ''}.`;
}

/** Sends the request, retrying for a few seconds while nothing's listening (the office restarting). */
async function send(req, fetchImpl) {
  const until = Date.now() + RETRY_MS;
  for (;;) {
    try {
      const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const text = await res.text();
      let body;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { error: text.slice(0, 300) };
      }
      return { status: res.status, body };
    } catch (err) {
      const code = err?.cause?.code ?? err?.code;
      if (code === 'ECONNREFUSED' && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw new Error(`Couldn't reach the office at ${new URL(req.url).origin} (${code ?? err?.message ?? err}). Is it running?`);
    }
  }
}

function readStdin(stdin) {
  return new Promise((resolve, reject) => {
    let data = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (c) => (data += c));
    stdin.on('end', () => resolve(data));
    stdin.on('error', reject);
  });
}

/**
 * Runs the command; resolves to its exit code.
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, stdin?: NodeJS.ReadableStream & { isTTY?: boolean }, fetch?: typeof fetch, out?: (s: string) => void, err?: (s: string) => void }} [io]
 */
export async function main(argv, io = {}) {
  const env = io.env ?? process.env;
  const stdin = io.stdin ?? process.stdin;
  const fetchImpl = io.fetch ?? fetch;
  const out = io.out ?? ((s) => process.stdout.write(s + '\n'));
  const err = io.err ?? ((s) => process.stderr.write(s + '\n'));
  try {
    const cmd = parseArgs(argv);
    if (cmd.cmd === 'help') {
      out(USAGE);
      return 0;
    }
    const office = officeEnv(env);
    let prompt;
    if (cmd.cmd === 'add' && cmd.prompt === undefined) {
      if (stdin.isTTY) throw new UsageError(`The task needs a prompt: pipe it in (office-queue add --title "…" <<'EOF' … EOF) or pass --prompt "…"`);
      prompt = await readStdin(stdin);
    }
    const req = buildRequest(cmd, office, prompt);
    const res = await send(req, fetchImpl);
    if (res.status < 200 || res.status >= 300) {
      err(`office-queue: ${refusal(res.status, res.body)}`);
      return 1;
    }
    if (cmd.cmd === 'list') out(formatQueue(res.body));
    else if (cmd.cmd === 'remove') out(`Took ${cmd.id} off the queue.`);
    else {
      const task = res.body?.task ?? {};
      out(task.id ?? '');
      err(`Queued “${task.title ?? cmd.title}” (${task.status ?? 'queued'}${cmd.issue !== undefined ? `, issue #${cmd.issue}` : ''}).`);
    }
    return 0;
  } catch (e) {
    err(`office-queue: ${e.message}`);
    if (e instanceof UsageError) err(`\n${USAGE}`);
    return e instanceof UsageError ? 2 : 1;
  }
}

const invoked = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invoked) process.exitCode = await main(process.argv.slice(2));
