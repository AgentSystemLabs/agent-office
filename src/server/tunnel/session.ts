import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { Office } from './office.js';

// Signing `agent-office tunnel` in to the office: with the session it kept from last time, or by
// asking for the password in the terminal. The session is what a browser's cookie is, good for two
// weeks, and is kept in a file only this user can read, so the password is asked for once.

/** Where the sessions are kept, one per office. */
export function sessionsFile(): string {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'agent-office', 'tunnel.json');
}

function saved(): Record<string, string> {
  try {
    const all = JSON.parse(readFileSync(sessionsFile(), 'utf8'));
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

/** Keeps the session for this office (or, without one, forgets it). */
function keep(office: string, token: string | undefined) {
  const all = saved();
  if (token) all[office] = token;
  else delete all[office];
  const file = sessionsFile();
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  } catch {
    // Not kept: the password is asked for again next time.
  }
}

const tildify = (file: string) => (file.startsWith(os.homedir() + path.sep) ? `~${file.slice(os.homedir().length)}` : file);

/** Someone's at a terminal to answer questions. */
const interactive = () => !!process.stdin.isTTY && !!process.stdout.isTTY;

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Asks without showing what's typed. */
function askHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  return new Promise((resolve) => {
    let typed = '';
    const done = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (text.startsWith('\u001b')) return; // an arrow key or the like
      for (const ch of text) {
        if (ch === '\r' || ch === '\n') {
          done();
          return resolve(typed);
        }
        // Ctrl-C and Ctrl-D: the terminal isn't sending signals while it hides the typing.
        if (ch === '\u0003' || ch === '\u0004') {
          done();
          process.emit('SIGINT');
          return;
        }
        if (ch === '\u007f' || ch === '\b') typed = typed.slice(0, -1);
        else if (ch >= ' ') typed += ch;
      }
    };
    // Before the question shows: what's typed the moment it does mustn't be echoed either.
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    stdout.write(question);
  });
}

export interface Credentials {
  /** An account's name; without one the password is the shared office password. */
  name?: string;
  password?: string;
}

/**
 * Signs in to the office: with the session kept from last time (`key` names the office in the
 * file), else the password given, else by asking. Resolves to why it couldn't, or '' when
 * `office.token` is good.
 */
export async function signIn(office: Office, key: string, given: Credentials, say: (line: string) => void): Promise<string> {
  const kept = saved()[key];
  if (kept) {
    office.token = kept;
    if ((await office.forwards()) !== 'signed-out') return '';
    office.token = '';
    keep(key, undefined);
  }
  if (given.password !== undefined) {
    const err = await office.signIn(given.name ?? '', given.password);
    if (!err) keep(key, office.token);
    // AGENT_OFFICE_PASSWORD may be another office's (one that runs on this computer): ask instead.
    if (!err || !interactive()) return err;
    say(`  ${err}`);
  }
  if (!interactive()) return 'Not signed in. Run it in a terminal to type the password, or set AGENT_OFFICE_PASSWORD (and --name for an account of your own).';

  const opts = await office.loginOptions();
  const askName = given.name === undefined && (opts.accounts || !opts.shared);
  say(`  Sign in to the office at ${office.origin} (asked once: the session is kept in ${tildify(sessionsFile())})`);
  for (let tries = 0; tries < 3; tries++) {
    const name = askName ? await ask(opts.shared ? '  Your name (Enter for the office password): ' : '  Your name: ') : (given.name ?? '');
    const err = await office.signIn(name, await askHidden(name ? '  Password: ' : '  Office password: '));
    if (!err) {
      keep(key, office.token);
      return '';
    }
    say(`  ${err}`);
    if (/too many/i.test(err)) return err;
  }
  return 'Sign-in failed';
}

/** The session stopped working (the password changed, the account was revoked): forget it. */
export function forget(office: Office, key: string) {
  office.token = '';
  keep(key, undefined);
}
