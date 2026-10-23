// A self-contained Node terminal for OpenHands Agent Canvas. Written into the Office data directory
// by the provider adapter, since the packaged server build does not copy source .mjs assets.
export const OPENHANDS_BRIDGE_SOURCE = String.raw`import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const BASE = 'http://127.0.0.1:8000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE = new Set(['running', 'idle', 'waiting_for_confirmation']);
const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const cwdArg = option('--cwd');
const initialPrompt = option('--prompt');
let conversationId = option('--resume');
let sessionKey;
let currentCwd;
let verifiedResume = false;
let busy = false;
let stopping = false;
let lastTimestamp;
const seen = new Set();

// Agent/tool text is untrusted terminal content. Strip control bytes (including ESC and C1)
// before it reaches the PTY; retain tabs and line feeds for readable tool results.
function safeText(value) { return String(value ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, ''); }
function output(message) { process.stdout.write(safeText(message) + '\r\n'); }
function short(value, limit = 10000) {
  const text = safeText(value);
  return text.length <= limit ? text : text.slice(0, limit) + '\n[Output truncated in Agent Office]';
}
function textParts(parts) {
  return Array.isArray(parts) ? parts.filter((x) => x && x.type === 'text' && typeof x.text === 'string').map((x) => x.text).join('\n') : '';
}
function normalizeDir(dir) {
  const resolved = path.resolve(dir);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
async function key() {
  if (sessionKey) return sessionKey;
  const location = path.join(homedir(), '.openhands', 'agent-canvas', 'api-key.txt');
  let value;
  try { value = (await readFile(location, 'utf8')).trim(); }
  catch { throw new Error('OpenHands Agent Canvas session key is unavailable for this account. Start Agent Canvas and check its local sign-in.'); }
  if (!value) throw new Error('OpenHands Agent Canvas session key is empty.');
  sessionKey = value;
  return value;
}
async function api(route, method = 'GET', body) {
  const send = async (value) => {
    try {
      return await fetch(BASE + route, {
        method,
        headers: { 'X-Session-API-Key': value, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error('Cannot reach OpenHands Agent Canvas at 127.0.0.1:8000. Start Agent Canvas and try again.');
    }
  };
  const previous = await key();
  let response = await send(previous);
  if (response.status === 401) {
    sessionKey = undefined;
    const refreshed = await key();
    if (refreshed !== previous) response = await send(refreshed);
  }
  if (!response.ok) {
    const error = new Error('OpenHands Agent Canvas API returned HTTP ' + response.status + ' for ' + method + ' ' + route.split('?')[0]);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? {} : response.json();
}
async function hook(type, status, fields = {}) {
  const base = process.env.AGENT_OFFICE_HOOK_URL;
  const worker = process.env.AGENT_OFFICE_WORKER_ID;
  const token = process.env.AGENT_OFFICE_HOOK_TOKEN;
  if (!base || !worker || !token || !conversationId) return;
  try {
    const url = new URL('/hooks/openhands', base);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return;
    url.searchParams.set('worker', worker);
    await fetch(url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ type, status, sessionId: conversationId,
        ...Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, typeof value === 'string' ? short(value, 4000) : value])) }),
      redirect: 'error',
      signal: AbortSignal.timeout(2500),
    });
  } catch { /* The terminal stays usable if Office restarts. */ }
}
async function checkCwd() {
  if (!cwdArg || !path.isAbsolute(cwdArg)) throw new Error('Agent Office did not provide an absolute project directory.');
  const candidate = await realpath(cwdArg);
  if (!(await stat(candidate)).isDirectory()) throw new Error('Agent Office project directory is not a directory.');
  currentCwd = candidate;
}
function isNvidiaModel(model) {
  return typeof model === 'string' && model.startsWith('nvidia_nim/') && model.length > 'nvidia_nim/'.length;
}
async function verifyResume() {
  if (!conversationId || verifiedResume) return;
  if (!UUID.test(conversationId)) throw new Error('The saved OpenHands conversation ID is invalid.');
  let existing;
  try { existing = await api('/api/conversations/' + conversationId); }
  catch (error) {
    if (error.status !== 404) throw error;
    output('The prior OpenHands conversation is unavailable; a new conversation will start with the next prompt.');
    conversationId = undefined;
    return;
  }
  const previous = existing.workspace && existing.workspace.working_dir;
  if (!previous || normalizeDir(previous) !== normalizeDir(currentCwd)) {
    throw new Error('The saved OpenHands conversation belongs to a different project directory; refusing to resume it.');
  }
  if (!isNvidiaModel(existing.agent && existing.agent.llm && existing.agent.llm.model)) {
    throw new Error('The saved OpenHands conversation does not use an NVIDIA model; refusing to resume it in this Office worker.');
  }
  verifiedResume = true;
  await events(false);
  output('Resumed OpenHands conversation ' + conversationId + '.');
  await hook('session', 'starting');
  if (ACTIVE.has(existing.execution_status)) {
    await hook('session', 'working');
    await watchRun();
  }
  else await hook('session', 'done');
}
async function createConversation(prompt) {
  const profiles = await api('/api/agent-profiles');
  const active = profiles.active_agent_profile_id;
  const agentProfile = Array.isArray(profiles.profiles) ? profiles.profiles.find((p) => p.id === active) : undefined;
  if (typeof active !== 'string' || !UUID.test(active) || !agentProfile) {
    throw new Error('OpenHands Agent Canvas has no active agent profile. Select the NVIDIA profile in Agent Canvas.');
  }
  const llmRef = agentProfile.llm_profile_ref;
  if (typeof llmRef !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(llmRef)) {
    throw new Error('The active OpenHands agent profile has no valid model profile reference. Select the NVIDIA profile in Agent Canvas.');
  }
  const llmProfile = await api('/api/profiles/' + encodeURIComponent(llmRef));
  if (!isNvidiaModel(llmProfile.config && llmProfile.config.model)) {
    throw new Error('The active OpenHands agent profile does not use NVIDIA. Select the NVIDIA profile in Agent Canvas.');
  }
  const created = await api('/api/conversations', 'POST', {
    workspace: { working_dir: currentCwd },
    agent_profile_id: active,
    initial_message: { role: 'user', content: [{ type: 'text', text: prompt }], run: true },
    autotitle: false,
  });
  if (typeof created.id !== 'string' || !UUID.test(created.id)) throw new Error('OpenHands did not return a valid conversation ID.');
  conversationId = created.id;
  verifiedResume = true;
  seen.clear();
  lastTimestamp = undefined;
  output('OpenHands conversation ' + conversationId + ' started in ' + currentCwd + '.');
  await hook('session', 'starting');
}
async function events(display) {
  let page;
  let count = 0;
  let newest = lastTimestamp;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (lastTimestamp) query.set('timestamp__gte', lastTimestamp);
    if (page) query.set('page_id', page);
    const batch = await api('/api/conversations/' + conversationId + '/events/search?' + query);
    if (!Array.isArray(batch.items)) throw new Error('OpenHands returned an invalid event page.');
    for (const event of batch.items) {
      if (typeof event.timestamp === 'string' && (!newest || event.timestamp > newest)) newest = event.timestamp;
      if (typeof event.id !== 'string' || seen.has(event.id)) continue;
      seen.add(event.id);
      if (display) await showEvent(event);
    }
    page = typeof batch.next_page_id === 'string' && batch.next_page_id ? batch.next_page_id : undefined;
    count++;
    if (count > 100) throw new Error('OpenHands event history exceeded the bridge page limit.');
  } while (page);
  lastTimestamp = newest;
}
async function showEvent(event) {
  if (event.kind === 'ActionEvent') {
    const action = event.action || {};
    if (action.kind === 'FinishAction') {
      if (action.message) output('\n' + short(action.message));
    } else {
      const tool = event.tool_name || action.kind || 'tool';
      const description = typeof action.command === 'string' ? action.command : (event.summary || action.kind || tool);
      output('\n[' + tool + '] ' + short(description, 5000));
      await hook('tool', 'working', { tool: String(tool), detail: short(description, 80) });
    }
  } else if (event.kind === 'ObservationEvent') {
    const observation = event.observation || {};
    if (observation.kind === 'FinishObservation') return;
    const result = textParts(observation.content);
    const code = typeof observation.exit_code === 'number' ? 'exit ' + observation.exit_code + ': ' : '';
    if (result || code) output('[' + code + (observation.kind || 'result') + ']\n' + short(result));
  } else if (event.kind === 'MessageEvent' && event.source === 'agent') {
    const reply = textParts(event.llm_message && event.llm_message.content);
    if (reply) output('\n' + short(reply));
  } else if (event.kind === 'ErrorEvent') {
    output('[OpenHands reported an error]');
  }
}
async function watchRun() {
  let waiting = false;
  let lastNotice = Date.now();
  while (!stopping) {
    await events(true);
    const state = await api('/api/conversations/' + conversationId);
    const status = state.execution_status;
    // Long inference/tool runs have no overall deadline. Individual HTTP requests remain bounded.
    // Keep watching the existing conversation; never submit another prompt to recover a watcher.
    if (ACTIVE.has(status) && Date.now() - lastNotice >= 60000) {
      output('[OpenHands status: ' + status + '; still watching this conversation]');
      if (status !== 'waiting_for_confirmation') await hook('session', 'working');
      lastNotice = Date.now();
    }
    if (status === 'waiting_for_confirmation') {
      if (!waiting) {
        output('OpenHands needs confirmation in Agent Canvas.');
        await hook('permission', 'needs_input', { detail: 'Approve the pending OpenHands action in Agent Canvas.' });
        waiting = true;
      }
    } else if (waiting && status === 'running') {
      waiting = false;
      await hook('session', 'working');
    }
    if (!ACTIVE.has(status)) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await events(true);
      if (status === 'error' || status === 'stuck') {
        output('OpenHands ended with status ' + status + '. Inspect Agent Canvas for details.');
        await hook('error', 'needs_input', { detail: 'OpenHands status: ' + status });
      } else {
        if (status === 'paused') output('OpenHands run paused.');
        await hook('session', 'done');
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
}
async function handlePrompt(prompt) {
  const clean = String(prompt || '').replace(/\r\n?/g, '\n').trim();
  if (!clean) return;
  busy = true;
  try {
    await checkCwd();
    await verifyResume();
    output('\n> ' + clean);
    if (!conversationId) await createConversation(clean);
    else {
      const body = { role: 'user', content: [{ type: 'text', text: clean }], run: true };
      try { await api('/api/conversations/' + conversationId + '/events', 'POST', body); }
      catch (error) {
        if (error.status !== 429) throw error;
        throw new Error('OpenHands rate limited the prompt. Check Agent Canvas for whether it was saved before retrying; Office did not start another run.');
      }
    }
    await hook('prompt', 'working', { prompt: clean });
    await watchRun();
  } catch (error) {
    output('[OpenHands bridge] ' + (error instanceof Error ? error.message : String(error)));
    await hook('error', 'needs_input', { detail: error instanceof Error ? error.message : 'Bridge error' });
  } finally {
    busy = false;
    if (!stopping) output('\nOpenHands ready for another prompt.');
  }
}
let queue = Promise.resolve();
function enqueue(prompt) { queue = queue.then(() => handlePrompt(prompt)); }
async function interrupt() {
  if (!busy || !conversationId) return;
  try { await api('/api/conversations/' + conversationId + '/interrupt', 'POST'); }
  catch (error) { output('[OpenHands bridge] Could not interrupt: ' + error.message); }
}

let pending = '';
let line = '';
let paste = false;
function onInput(chunk) {
  pending += chunk;
  while (pending) {
    if (pending.startsWith('\x1b[200~')) { paste = true; pending = pending.slice(6); continue; }
    if (pending.startsWith('\x1b[201~')) { paste = false; pending = pending.slice(6); continue; }
    if (pending[0] === '\x1b') {
      if ('\x1b[200~'.startsWith(pending) || '\x1b[201~'.startsWith(pending)) break;
      const match = /^\x1b\[[0-9;]*[A-Za-z~]/.exec(pending);
      if (match) { pending = pending.slice(match[0].length); continue; }
      pending = pending.slice(1);
      continue;
    }
    const ch = pending[0];
    pending = pending.slice(1);
    if (ch === '\x03') { void interrupt(); continue; }
    if (!paste && (ch === '\r' || ch === '\n')) {
      const submitted = line;
      line = '';
      if (submitted.trim()) enqueue(submitted);
    } else if (ch === '\x7f' || ch === '\b') line = line.slice(0, -1);
    else line += ch;
  }
}
process.stdin.setEncoding('utf8');
if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true);
process.stdin.on('data', onInput);
process.stdin.resume();
process.on('SIGINT', () => { void interrupt(); });
process.on('SIGTERM', () => { stopping = true; void interrupt().finally(() => process.exit(0)); });

output('OpenHands Agent Canvas bridge (local API). Ctrl+C interrupts the current run.');
if (initialPrompt) enqueue(initialPrompt);
else if (conversationId) {
  queue = queue.then(async () => {
    busy = true;
    try { await checkCwd(); await verifyResume(); output('OpenHands ready for another prompt.'); }
    catch (error) { output('[OpenHands bridge] ' + error.message); await hook('error', 'needs_input', { detail: error.message }); }
    finally { busy = false; }
  });
} else output('OpenHands ready for a prompt.');
`;
