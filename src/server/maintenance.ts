// The maintenance closet: an agent who works on Agent Office itself, and a laptop to ask him (or,
// quicker, a small model) about it. Both look at the office's own source, which is the checkout this
// server runs from (or AGENT_OFFICE_SOURCE), not the floor's project.

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAINTENANCE_MODEL } from '../shared/layout.js';
import { childEnv, resolveCommand } from './workers.js';

const ANSWER_TIMEOUT_MS = 3 * 60_000;
const MAX_ANSWER = 20_000;
export const MAX_QUESTION = 4000;

/** The folder holding the office's own source: AGENT_OFFICE_SOURCE, else the install this server runs from (src/server under tsx, dist/server built). */
export function officeSourceDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const given = env.AGENT_OFFICE_SOURCE?.trim();
  if (given) return existsSync(given) ? path.resolve(given) : undefined;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++, dir = path.dirname(dir)) {
    try {
      if (JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'agent-office') return dir;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

/**
 * Where the Maintenance agent works: his own worktree of the office's source (see maintenance-stack.ts),
 * set once it's been made. Workers starts him there rather than in the floor's project.
 */
export const maintenanceTree: { dir?: string } = {};

/** What the laptop's model is told about its job, ahead of the question. */
export const LAPTOP_BRIEF = [
  `You answer questions about Agent Office, the 3D multiplayer office this very question is typed into, from its source code and docs in the current folder (README.md, docs/, src/).`,
  `You can read files but not change anything: you're read-only. If the person is asking for a change, say briefly how you'd do it and that the Maintenance agent at the counter beside the laptop can build it.`,
  "Be short and concrete: a few sentences or a short list, naming the files that matter in backticks like `src/server/workers.ts:560` (never as links: the person can't open them). Say so when you don't know.",
  `The question:`,
].join('\n\n');

/** The model the laptop answers with: gpt-6-luna unless AGENT_OFFICE_MAINTENANCE_MODEL says another. */
export function laptopModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.AGENT_OFFICE_MAINTENANCE_MODEL?.trim() || MAINTENANCE_MODEL;
}

export function laptopArgs(question: string, model: string): string[] {
  return ['exec', '--model', model, '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--color', 'never', `${LAPTOP_BRIEF}\n\n${question}`];
}

/**
 * Answers a question about the office with the small model, through `codex exec` in the office's source
 * (read-only, nothing kept of the session). Resolves with what it said, or why it couldn't.
 */
export function askLaptop(question: string, opts: { codex?: string; env?: NodeJS.ProcessEnv } = {}): Promise<{ answer: string } | { error: string }> {
  const env = opts.env ?? process.env;
  const cwd = officeSourceDir(env);
  if (!cwd) return Promise.resolve({ error: "Can't find the office's own source to look things up in (set AGENT_OFFICE_SOURCE)" });
  const model = laptopModel(env);
  // Found the way workers find it: the office runs with a bare PATH (under systemd it has no ~/.local/bin), so a
  // plain `codex` isn't there to be found. It runs with the environment workers get, with its own folder and node's first on PATH.
  const codex = opts.codex ?? resolveCommand('codex');
  if (!codex) return Promise.resolve({ error: "The codex CLI isn't installed on the office machine (or isn't on its PATH), so the laptop has nothing to ask" });
  const base = opts.env ?? childEnv();
  const childPath = [path.dirname(codex), path.dirname(process.execPath), base.PATH].filter(Boolean).join(path.delimiter);
  return new Promise((resolve) => {
    const child = execFile(codex, laptopArgs(question, model), { cwd, env: { ...base, PATH: childPath }, timeout: ANSWER_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const answer = stdout.trim().slice(0, MAX_ANSWER);
      if (answer && !(err && 'killed' in err && err.killed)) return resolve({ answer });
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return resolve({ error: `Couldn't run ${codex}: it, or the node it needs, is missing` });
      if (err && 'killed' in err && err.killed) return resolve({ error: `The laptop gave up waiting for ${model} after ${ANSWER_TIMEOUT_MS / 60_000} minutes` });
      const why = stderr.trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300);
      resolve({ error: why || `${model} didn't answer` });
    });
    // With stdin left open, `codex exec` waits for more of the prompt after reading it from argv.
    child.stdin?.end();
  });
}
