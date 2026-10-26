#!/usr/bin/env node
/** An opt-in, finite supervisor. It wakes an idle coordinator; it never edits GitHub issues. */
import { readFileSync, writeFileSync, renameSync, mkdirSync, lstatSync, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { candidates, decisionsOf, fingerprint, gate } from './autopilot/policy.mjs';

const exec = promisify(execFile);
const configFile = process.argv[2];
if (!configFile) throw new Error('Usage: office-autopilot.js /absolute/path/to/local-config.json');
const config = JSON.parse(readFileSync(configFile, 'utf8'));
if (!Number.isSafeInteger(config.maxRounds) || config.maxRounds < 1 || config.maxRounds > 20 || !Number.isFinite(config.expiresAt) || !Number.isSafeInteger(config.pollSeconds) || config.pollSeconds < 15 || config.pollSeconds > 600 || !Number.isSafeInteger(config.maxNewWorkers) || config.maxNewWorkers < 1 || config.maxNewWorkers > 4) throw new Error('Finite rounds, expiry, polling and worker limits are required');
const project = realpathSync(config.projectDir);
mkdirSync(path.dirname(config.stateFile), { recursive: true });
const read = file => JSON.parse(readFileSync(file, 'utf8'));
function write(file, value) {
  const tmp = file + '.' + randomUUID() + '.tmp';
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
}
const state = existsSync(config.stateFile) ? read(config.stateFile) : { rounds: [], inspected: {} };
// A crash after preparation may have delivered the request. Never blindly replay it.
for (const round of state.rounds) if (round.state === 'prepared') round.state = 'uncertain';
write(config.stateFile, state);
let cookie = '';
const base = config.baseUrl;
// HTTP cookies are scoped by the native host/port. Use that same origin for WS
// rather than mixing a public proxy Host with a loopback login cookie.
const origin = new URL(base).origin;
async function request(route, body) {
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { Host: new URL(origin).host, Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) { const error = new Error(`Office request refused (${response.status})`); error.status = response.status; throw error; }
  return response;
}
async function login() {
  const response = await request('/api/login', { password: readFileSync(config.passwordFile, 'utf8').trim() });
  cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  if (!cookie) throw new Error('Office session unavailable');
}
async function snapshot() {
  return new Promise((resolve, reject) => {
    const url = new URL('/ws', base); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = new URLSearchParams({ floor: config.floor, name: 'Office autopilot' }).toString();
    const ws = new WebSocket(url, { headers: { Host: new URL(origin).host, Origin: origin, Cookie: cookie } });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('Office snapshot timeout')); }, 10_000);
    ws.on('error', () => { clearTimeout(timer); reject(new Error('Office snapshot unavailable')); });
    ws.on('message', raw => {
      const message = JSON.parse(String(raw));
      if (message.t === 'welcome') { clearTimeout(timer); ws.close(); resolve(message); }
    });
  });
}
function status(kind, summary, extra = {}) {
  write(path.join(project, '.agent-office/autopilot-status.json'), { state: kind, summary, at: Date.now(), rounds: state.rounds.length, maxRounds: config.maxRounds, expiresAt: config.expiresAt, ...extra });
}
function manifestFile(worker, round) {
  const root = realpathSync(path.resolve(project, worker.worktree?.path || '.'));
  if (root !== project && !root.startsWith(project + path.sep)) throw new Error('Coordinator outside project');
  const output = path.join(root, 'outputs/office-autopilot', round.id + '.json');
  if (!existsSync(output)) return;
  if (!lstatSync(output).isFile() || realpathSync(output) !== output || lstatSync(output).size > 100_000) throw new Error('Invalid cycle manifest file');
  return output;
}
async function tick() {
  const current = JSON.parse(readFileSync(configFile, 'utf8'));
  // The running process cannot extend its own campaign after a config edit.
  const effective = { ...config, enabled: current.enabled === true, expiresAt: Math.min(config.expiresAt, current.expiresAt) };
  const budget = gate({ now: Date.now(), config: effective, state, workers: [] });
  if (budget !== 'ready' && !state.rounds.some(round => round.state === 'sent')) return status(budget, 'Automatic selection paused or its finite campaign has ended.');
  await login();
  const office = await snapshot();
  const workers = office.workers || [];
  const coordinator = workers.find(worker => worker.name === config.coordinatorName);
  const outstanding = state.rounds.find(round => round.state === 'sent');
  if (outstanding) {
    if (!coordinator) return status('needs-reconciliation', 'The coordinator of a sent cycle is missing.');
    const file = manifestFile(coordinator, outstanding);
    if (file && !['starting', 'working', 'needs_input'].includes(coordinator.status)) {
      const decisions = decisionsOf(read(file), outstanding);
      for (const decision of decisions) state.inspected[decision.issue] = outstanding.issues.find(issue => issue.number === decision.issue).fingerprint;
      Object.assign(outstanding, { state: 'recorded', decisions, manifest: file, finishedAt: Date.now() });
      write(config.stateFile, state);
    } else return status('waiting-for-coordinator', 'The current selection cycle is still running; it will not be replayed.');
  }
  const sourceStatus = config.externalStatusFile ? read(config.externalStatusFile) : {};
  const sourceQueue = config.externalQueueFile ? read(config.externalQueueFile) : { tasks: [] };
  const waiting = gate({ now: Date.now(), config: effective, state, workers, externalPending: sourceStatus.pending_reconciliation || [] });
  if (waiting !== 'ready') return status(waiting, 'Waiting for existing work, QA or reconciliation before selecting another issue.', { activeWorkers: workers.filter(worker => ['starting', 'working', 'needs_input'].includes(worker.status)).map(worker => worker.name) });
  const { stdout } = await exec(config.githubCli || 'gh', ['issue', 'list', '--repo', config.repository, '--state', 'open', '--limit', '500', '--json', 'number,title,body,labels,assignees,updatedAt,author,url'], { cwd: project, timeout: 30_000, maxBuffer: 10_000_000 });
  const issues = JSON.parse(stdout);
  // A live native ready-contract dispatcher owns all ready execution, including
  // a new stage it has not claimed yet. This supervisor must not race it.
  const nativeReady = sourceStatus.discover_ready ? issues.filter(issue => issue.labels.some(label => label.name === 'execution:ready')).map(issue => issue.number) : [];
  const available = candidates(issues, { owner: config.repository.split('/')[0], reserved: [...(config.reservedIssues || []), ...nativeReady, ...(sourceQueue.tasks || []).map(task => task.issue)], completed: sourceStatus.completed_jobs || [], inspected: state.inspected });
  if (!available.length) return status('waiting-for-eligible-issue', 'No new unheld, unclaimed issue is eligible; completed stages will not be replayed.', { openIssues: issues.length, heldIssues: issues.filter(issue => issue.labels.some(label => label.name === 'execution:held')).length });
  const profiles = (await (await request('/api/worker-profiles?floor=' + encodeURIComponent(config.floor))).json()).profiles;
  const profile = profiles.find(profile => profile.name === config.coordinatorName && profile.enabled);
  if (!profile) return status('coordinator-held', 'The configured coordinator is unavailable; no substitute was selected.');
  const round = { id: 'cycle-' + randomUUID(), state: 'prepared', at: Date.now(), issues: available.slice(0, 12).map(issue => ({ number: issue.number, fingerprint: fingerprint(issue) })) };
  const output = 'outputs/office-autopilot/' + round.id + '.json';
  const prompt = `AUTOPILOT ${round.id}\nUser authorized autonomous selection of board issues in this experimental copy. Continue as the named coordinator, preserving exact team routes and source holds. First collect completed workers' outputs and independent QA. Select from the issue candidates below after reading each current Issue and all comments; board titles are not task contracts. Check current writers and dependencies.\n\nHard limits: at most ${config.maxNewWorkers} new worker launches this cycle, at most 15 minutes per worker, no extra agents beyond that, no CLI/model/effort fallback, no unbounded polling. Reuse an idle existing worker by office-workers tell rather than duplicate its persona. The current available profiles are ${JSON.stringify(profiles.filter(profile => profile.enabled).map(profile => ({ name: profile.name, provider: profile.provider, model: profile.model, effort: profile.effort })))}.\n\nIssues marked prepare-contract-only are for read-only assessment and a local proposed task contract; do not execute their underlying task. Only validate-ready-contract items may execute, after checking a complete first-party typed contract, fresh unique stage, correct writer/reviewer, dependencies and scoped write permission. Never remove holds, replay completed stages, claim another writer's task, or count a draft as acceptance. No original Orch mutation, GitHub issue/PR/label/state writes, production changes, publishing, credential operations, purchases, external messages or new recurring jobs. Local worktrees and outputs only. Independent QA stays separate. Preserve all more specific source STOPs.\n\n${config.instructions || ''}\n\nCandidates: ${JSON.stringify(available.slice(0, 12).map(issue => ({ number: issue.number, title: issue.title, mode: issue.mode, url: issue.url })))}\n\nBefore ending, write ONLY this selection manifest in your worktree at ${output}: {"cycle_id":"${round.id}","decisions":[{"issue":NUMBER,"action":"assigned|blocked|already-claimed|needs-contract|completed","reason":"concrete evidence and artifact/worker id"}]}. Use needs-contract for preparation that has no execution grant. Use completed only for actual accepted scope; selection is not completion. Cover each candidate you assessed, report artifact paths, then stop. This finite supervisor will select the next round later.`;
  state.rounds.push(round); write(config.stateFile, state);
  try {
    const response = await request('/api/worker-profiles?floor=' + encodeURIComponent(config.floor), { id: profile.id, prompt, reuseIdle: true });
    const result = await response.json();
    Object.assign(round, { state: 'sent', workerId: result.workerId, sentAt: Date.now() });
    write(config.stateFile, state);
    status('selecting', 'The coordinator is selecting the next suitable issue and checking its task contract.', { cycle: round.id });
  } catch (error) {
    round.state = error.status === 409 ? 'refused' : 'uncertain'; write(config.stateFile, state);
    status(round.state === 'refused' ? 'waiting-for-team' : 'needs-reconciliation', round.state === 'refused' ? 'The coordinator became busy or its profile was held; no duplicate task was sent.' : 'A dispatch response was uncertain; automatic replay is blocked.');
  }
}
let stopped = false;
process.on('SIGTERM', () => { stopped = true; });
process.on('SIGINT', () => { stopped = true; });
while (!stopped) {
  try { await tick(); } catch { cookie = ''; status('unavailable', 'A required source or service could not be verified; no new work was selected.'); }
  if (process.argv.includes('--once')) break;
  await new Promise(resolve => {
    const finish = () => { clearTimeout(timer); process.off('SIGTERM', finish); process.off('SIGINT', finish); resolve(); };
    const timer = setTimeout(finish, config.pollSeconds * 1000);
    process.once('SIGTERM', finish); process.once('SIGINT', finish);
  });
}
