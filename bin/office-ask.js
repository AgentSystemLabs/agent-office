#!/usr/bin/env node
// office-ask: put a question to the people in Agent Office and wait for their answer, for the agent
// standing in the Study (see src/server/stations.ts). The question shows up as a dialog in the office,
// so nobody has to watch the agent's terminal. The office puts it on the agent's PATH and gives it its
// address and token in AGENT_OFFICE_HOOK_URL, AGENT_OFFICE_WORKER_ID and AGENT_OFFICE_HOOK_TOKEN. Plain
// Node, no build step, no dependencies.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage:
  office-ask "Question?" [--option "Label" ...] [--multi] [--header "Short title"]

Asks the people in the office and prints their answer. With two or more --option flags they get those
to pick from (and can always type something else); with none they type an answer. --multi lets them
pick more than one option. Give a command timeout of 10 minutes (600000 ms): it waits for the answer.
If it prints NO_ANSWER_YET, nobody has answered so far: run the same command again.`;

/** How long one request to the office holds, and how long the command keeps asking before it gives up. */
const HOLD_MS = 240_000;
const GIVE_UP_MS = 9 * 60_000;
export const NO_ANSWER = 'NO_ANSWER_YET: nobody has answered yet. Run the same office-ask command again to keep waiting.';

class UsageError extends Error {}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const out = { question: '', options: [], multi: false, header: undefined };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v === '') throw new UsageError(`${a} needs a value`);
      return v;
    };
    if (a === '-h' || a === '--help') return { help: true };
    else if (a === '--option') out.options.push(value());
    else if (a === '--multi') out.multi = true;
    else if (a === '--header') out.header = value();
    else if (a.startsWith('--')) throw new UsageError(`Unknown option ${a}`);
    else rest.push(a);
  }
  out.question = rest.join(' ').trim();
  if (!out.question) throw new UsageError('Give it the question, e.g. office-ask "Who is this for?" --option "Customers" --option "Staff"');
  if (out.options.length === 1) throw new UsageError('Give at least two --option flags, or none for a question that wants typing');
  if (out.multi && out.options.length < 2) throw new UsageError('--multi needs at least two --option flags');
  return out;
}

/** @param {Record<string, string | undefined>} env */
export function officeEnv(env) {
  const missing = ['AGENT_OFFICE_HOOK_URL', 'AGENT_OFFICE_WORKER_ID', 'AGENT_OFFICE_HOOK_TOKEN'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`${missing.join(', ')} ${missing.length === 1 ? "isn't" : "aren't"} set. office-ask only works inside Agent Office, from the terminal of the agent in the Study or at the Issues board.`);
  return { url: env.AGENT_OFFICE_HOOK_URL.replace(/\/+$/, ''), worker: env.AGENT_OFFICE_WORKER_ID, token: env.AGENT_OFFICE_HOOK_TOKEN };
}

/**
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, fetch?: typeof fetch, out?: (s: string) => void, err?: (s: string) => void, giveUpMs?: number }} [io]
 */
export async function main(argv, io = {}) {
  const env = io.env ?? process.env;
  const fetchImpl = io.fetch ?? fetch;
  const out = io.out ?? ((s) => process.stdout.write(s + '\n'));
  const err = io.err ?? ((s) => process.stderr.write(s + '\n'));
  const until = Date.now() + (io.giveUpMs ?? GIVE_UP_MS);
  try {
    const cmd = parseArgs(argv);
    if (cmd.help) {
      out(USAGE);
      return 0;
    }
    const office = officeEnv(env);
    const url = new URL(`${office.url}/office/ask`);
    url.searchParams.set('worker', office.worker);
    const body = JSON.stringify({ question: cmd.question, options: cmd.options, multi: cmd.multi, header: cmd.header });
    for (;;) {
      let res;
      try {
        res = await fetchImpl(url.href, { method: 'POST', headers: { authorization: `Bearer ${office.token}`, 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(HOLD_MS + 20_000) });
      } catch (e) {
        throw new Error(`Couldn't reach the office at ${url.origin} (${e?.cause?.code ?? e?.message ?? e}). Is it running?`);
      }
      const text = await res.text();
      let json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { error: text.slice(0, 300) };
      }
      if (res.status < 200 || res.status >= 300) {
        err(`office-ask: The office said no (${res.status})${json.error ? `: ${json.error}` : ''}.`);
        return 1;
      }
      if (typeof json.answer === 'string') {
        out(json.answer);
        return 0;
      }
      if (Date.now() >= until) {
        out(NO_ANSWER);
        return 0;
      }
    }
  } catch (e) {
    err(`office-ask: ${e.message}`);
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
