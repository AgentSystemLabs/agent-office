#!/usr/bin/env node
// office-reels: the office's reels studio, from inside Agent Office. The crew running a faceless
// short-video page (a scout, a writer, an editor and an analyst, each an ordinary worker) adds
// ideas, writes scripts, approves the videos the studio makes and reads the numbers with it; the
// studio makes the videos and posts them (src/server/reels/). The office puts it on every worker's
// PATH with AGENT_OFFICE_HOOK_URL, AGENT_OFFICE_WORKER_ID and AGENT_OFFICE_HOOK_TOKEN, and this talks
// to /office/reels with them. `office-reels mcp` is the same as an MCP server on stdio. Plain Node,
// no build step, no dependencies.

import { realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage:
  office-reels status [--series <s>] [--json]   the series, the reels on the go, the crew, what's set up
  office-reels show <reel> [--json]             one reel in full: its script, caption, video, posts
  office-reels series add [fields]              start a series (or its fields as JSON on stdin)
  office-reels series set <series> [fields]     change one (--pause / --resume to stop and start it)
      fields: --name --niche --style --voice --tone --music <file> --platforms tiktok,instagram,youtube
              --postsPerDay <n> --backlog <n> --cta --hashtags a,b --tiktokPrivacy --youtubePrivacy
  office-reels idea <series> --title "…" [--hook "…"] [--idea "…"]
  office-reels script <reel> <<'EOF'            a script for an idea (or a rejected reel), as JSON:
  {"title": "…", "hook": "…", "scenes": [{"narration": "…", "visual": "…"}], "caption": "…", "hashtags": []}
  EOF                                           (script --series <s> makes a new reel from it)
  office-reels review <reel> --approve          approve a rendered reel for posting
  office-reels review <reel> --reject --note "what to fix"
  office-reels remake <reel>                    make its video again
  office-reels post <reel>                      post an approved reel now, outside its schedule
  office-reels stats [--json]                   fetch every post's views, likes, comments, shares
  office-reels note <series> "…"                write down what the numbers taught (or on stdin)
  office-reels crew hire [--series <s>] [--roles scout,writer,editor,analyst]
                         [--provider <p>] [--model <m>] [--effort <e>]
                                                hire the crew: a worker for each role nobody has
  office-reels crew join <role> [--series <s>]  join the crew yourself, in a role
  office-reels brief <role> [--series <s>]      what a crew member in a role is told
  office-reels mcp                              serve these as MCP tools on stdio`;

export class UsageError extends Error {}

const ENV = ['AGENT_OFFICE_HOOK_URL', 'AGENT_OFFICE_WORKER_ID', 'AGENT_OFFICE_HOOK_TOKEN'];
export const ROLES = ['scout', 'writer', 'editor', 'analyst'];
const RETRY_MS = 6000;
/** Posting waits for each platform to process the video; the numbers ask every platform. */
const TIMEOUT_MS = { get: 15_000, post: 20 * 60_000, stats: 120_000, crew: 90_000, other: 30_000 };
const SERIES_FIELDS = ['--name', '--niche', '--style', '--voice', '--tone', '--music', '--platforms', '--postsPerDay', '--backlog', '--cta', '--hashtags', '--tiktokPrivacy', '--youtubePrivacy'];

function options(args, valued, bare) {
  /** @type {Record<string, string | true>} */
  const opts = {};
  const words = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      if (arg.startsWith('-') && arg.length > 1) throw new UsageError(`Unknown option: ${arg}`);
      words.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    if (bare.includes(flag)) {
      if (eq > 0) throw new UsageError(`${flag} takes no value`);
      opts[flag] = true;
    } else if (valued.includes(flag)) {
      if (eq > 0) opts[flag] = arg.slice(eq + 1);
      else if (i + 1 < args.length) opts[flag] = args[++i];
      else throw new UsageError(`${flag} needs a value`);
    } else throw new UsageError(`Unknown option: ${flag}`);
  }
  return { opts, words };
}

/** The flags a series takes, as the fields the studio reads. */
function seriesFields(opts) {
  const out = {};
  for (const f of SERIES_FIELDS) if (opts[f] !== undefined) out[f.slice(2)] = opts[f];
  for (const k of ['platforms', 'hashtags']) if (typeof out[k] === 'string') out[k] = out[k].split(/[\s,]+/).filter(Boolean);
  for (const k of ['postsPerDay', 'backlog']) if (out[k] !== undefined) out[k] = Number(out[k]);
  if (opts['--pause']) out.paused = true;
  if (opts['--resume']) out.paused = false;
  return out;
}

const one = (words, what) => {
  if (words.length !== 1) throw new UsageError(`Give one ${what}`);
  return words[0];
};

/**
 * What the command line asks for: the call to make (`method`, `path`, `body`), and how to show it.
 * `stdin` says the body (or a field of it) comes on stdin.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const help = (a) => a === '-h' || a === '--help';
  if (cmd === undefined || cmd === 'help' || help(cmd) || rest.some(help)) return { cmd: 'help' };
  if (cmd === 'mcp') return { cmd: 'mcp' };
  if (cmd === 'status' || cmd === 'ls') {
    const { opts, words } = options(rest, ['--series'], ['--json']);
    if (words.length) throw new UsageError('status takes no arguments');
    return { cmd, method: 'GET', path: '', json: !!opts['--json'], ...(opts['--series'] ? { series: opts['--series'] } : {}) };
  }
  if (cmd === 'show') {
    const { opts, words } = options(rest, [], ['--json']);
    return { cmd, method: 'GET', path: '/reel', query: { id: one(words, 'reel id') }, json: !!opts['--json'] };
  }
  if (cmd === 'brief') {
    const { opts, words } = options(rest, ['--series'], []);
    const role = one(words, `role (${ROLES.join(', ')})`);
    return { cmd, method: 'GET', path: '/brief', query: { role, ...(opts['--series'] ? { series: opts['--series'] } : {}) } };
  }
  if (cmd === 'series') {
    const [sub, ...more] = rest;
    const { opts, words } = options(more, SERIES_FIELDS, ['--pause', '--resume']);
    if (sub === 'add') {
      if (words.length) throw new UsageError('series add takes its fields as flags or JSON on stdin');
      const body = seriesFields(opts);
      return { cmd, method: 'POST', path: '/series', body, stdin: Object.keys(body).length ? undefined : 'json' };
    }
    if (sub === 'set') return { cmd, method: 'POST', path: '/series/set', body: { series: one(words, 'series'), ...seriesFields(opts) } };
    throw new UsageError('series add, or series set <series>');
  }
  if (cmd === 'idea') {
    const { opts, words } = options(rest, ['--title', '--hook', '--idea'], []);
    if (!opts['--title']) throw new UsageError('An idea needs --title');
    return { cmd, method: 'POST', path: '/idea', body: { series: one(words, 'series'), title: opts['--title'], hook: opts['--hook'], idea: opts['--idea'] } };
  }
  if (cmd === 'script') {
    const { opts, words } = options(rest, ['--series'], []);
    if (opts['--series'] && words.length) throw new UsageError('Give a reel, or --series for a new one, not both');
    const target = opts['--series'] ? { series: opts['--series'] } : { reel: one(words, 'reel id (or --series <s> for a new reel)') };
    return { cmd, method: 'POST', path: '/script', body: target, stdin: 'json' };
  }
  if (cmd === 'review') {
    const { opts, words } = options(rest, ['--note'], ['--approve', '--reject']);
    if (!!opts['--approve'] === !!opts['--reject']) throw new UsageError('review takes --approve or --reject');
    return { cmd, method: 'POST', path: '/review', body: { reel: one(words, 'reel id'), approve: !!opts['--approve'], note: opts['--note'] ?? '' } };
  }
  if (cmd === 'remake' || cmd === 'post') {
    const { words } = options(rest, [], []);
    return { cmd, method: 'POST', path: `/${cmd}`, body: { reel: one(words, 'reel id') } };
  }
  if (cmd === 'stats') {
    const { opts, words } = options(rest, [], ['--json']);
    if (words.length) throw new UsageError('stats takes no arguments');
    return { cmd, method: 'POST', path: '/stats', body: {}, json: !!opts['--json'] };
  }
  if (cmd === 'note') {
    const { words } = options(rest, [], []);
    if (!words.length || words.length > 2) throw new UsageError('note <series> "…" (or the note on stdin)');
    return { cmd, method: 'POST', path: '/note', body: { series: words[0], ...(words[1] ? { text: words[1] } : {}) }, stdin: words[1] ? undefined : 'text' };
  }
  if (cmd === 'crew') {
    const [sub, ...more] = rest;
    const { opts, words } = options(more, ['--series', '--roles', '--provider', '--model', '--effort'], []);
    const series = opts['--series'] ? { series: opts['--series'] } : {};
    if (sub === 'join') return { cmd, method: 'POST', path: '/crew/join', body: { role: one(words, `role (${ROLES.join(', ')})`), ...series } };
    if (sub === 'hire') {
      if (words.length) throw new UsageError('crew hire takes only options');
      const roles = opts['--roles'] ? String(opts['--roles']).split(/[\s,]+/).filter(Boolean) : undefined;
      const bad = roles?.find((r) => !ROLES.includes(r));
      if (bad) throw new UsageError(`roles are ${ROLES.join(', ')} (got ${bad})`);
      const pick = Object.fromEntries(['provider', 'model', 'effort'].filter((k) => opts[`--${k}`]).map((k) => [k, opts[`--${k}`]]));
      return { cmd, method: 'POST', path: '/crew', body: { ...series, ...(roles ? { roles } : {}), ...pick } };
    }
    throw new UsageError('crew hire, or crew join <role>');
  }
  throw new UsageError(`Unknown command: ${cmd}`);
}

export function officeEnv(env) {
  const missing = ENV.filter((k) => !env[k]);
  if (missing.length) throw new Error(`${missing.join(', ')} ${missing.length === 1 ? "isn't" : "aren't"} set. office-reels only works inside Agent Office, from a worker's terminal.`);
  return { url: env.AGENT_OFFICE_HOOK_URL.replace(/\/+$/, ''), worker: env.AGENT_OFFICE_WORKER_ID, token: env.AGENT_OFFICE_HOOK_TOKEN };
}

/** The HTTP request for a call to the studio. */
export function buildRequest(call, office) {
  const url = new URL(`${office.url}/office/reels${call.path}`);
  url.searchParams.set('worker', office.worker);
  for (const [k, v] of Object.entries(call.query ?? {})) url.searchParams.set(k, String(v));
  const headers = { authorization: `Bearer ${office.token}` };
  const timeout = call.method === 'GET' ? TIMEOUT_MS.get : TIMEOUT_MS[call.path.slice(1)] ?? TIMEOUT_MS.other;
  if (call.method === 'GET') return { method: 'GET', url: url.href, headers, timeout };
  return { method: 'POST', url: url.href, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(call.body ?? {}), timeout };
}

async function send(req, fetchImpl) {
  const until = Date.now() + RETRY_MS;
  for (;;) {
    try {
      const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body, signal: AbortSignal.timeout(req.timeout) });
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

export async function call(c, io) {
  const res = await send(buildRequest(c, officeEnv(io.env)), io.fetch);
  if (res.status === 404 && !res.body?.error) throw new Error("The office doesn't know office-reels (404): it's running an older Agent Office. Restart or upgrade it.");
  if (res.status < 200 || res.status >= 300) throw new Error(res.body?.error || `The office said no (${res.status}).`);
  return res.body;
}

const ago = (t) => {
  if (!t) return 'never';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 60 ? `${m}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

/** How everything stands, for people. */
export function formatStatus(v, only) {
  const lines = [];
  const media = v.media ?? {};
  lines.push(`Voice: ${media.voice ?? '?'} · images: ${media.images ?? '?'} · connected: ${v.connected?.length ? v.connected.join(', ') : 'nothing yet (see docs/reels.md)'}`);
  if (v.you?.crew?.length) lines.push(`You (${v.you.name}) are the ${v.you.crew.join(' and ')}.`);
  if (!v.series?.length) lines.push('No series yet: office-reels series add --name "…" --niche "…" --platforms tiktok,youtube');
  for (const s of v.series ?? []) {
    if (only && s.id !== only && s.name.toLowerCase() !== String(only).toLowerCase()) continue;
    const p = s.pipeline ?? {};
    lines.push('', `▶ ${s.name} (${s.id})${s.paused ? ' · PAUSED' : ''} · ${s.platforms.join(', ') || 'no platforms'} · ${s.postsPerDay}/day · last post ${ago(s.lastPost)}`);
    lines.push(`  ${s.niche}`);
    lines.push(`  ideas ${p.ideas} · in the pipeline ${p.inPipe} (backlog ${s.backlog}) · to review ${p.toReview} · approved ${p.approved} · posted ${p.posted}${p.failed ? ` · failed ${p.failed}` : ''}`);
    for (const n of s.notes ?? []) lines.push(`  📝 ${n.text} — ${n.by}`);
  }
  const reels = (v.reels ?? []).filter((r) => !only || r.series === only || v.series?.find((s) => s.id === r.series)?.name.toLowerCase() === String(only).toLowerCase());
  if (reels.length) lines.push('', 'Reels:');
  for (const r of reels) {
    const posts = (r.posts ?? []).map((p) => `${p.platform}${p.error ? ' ✗' : p.views !== undefined ? ` ${p.views} views` : ' ✓'}`).join(', ');
    lines.push(`  ${r.id}  [${r.status}] ${r.title}${r.seconds ? ` · ${r.seconds}s` : ''} · ${r.by}${posts ? ` · ${posts}` : ''}${r.review ? ` · editor: ${r.review}` : ''}${r.error ? ` · ${r.error}` : ''}`);
  }
  if (v.crew?.length) lines.push('', `Crew: ${v.crew.map((c) => `${c.name} (${c.role}${c.seriesId ? ` on ${c.seriesId}` : ''}, ${c.status})`).join(', ')}`);
  else lines.push('', 'No crew yet: office-reels crew hire');
  return lines.join('\n');
}

/** What a POST did, in a line or two. */
export function formatResult(cmd, r) {
  if (cmd === 'crew' && r.hired) return [...r.hired.map((h) => `✓ hired ${h.name} as ${h.role} (${h.id})`), ...(r.skipped ?? []).map((s) => `– ${s}`)].join('\n') || 'Nobody hired.';
  if (cmd === 'crew' && r.brief) return `✓ You're on the crew. Your brief:\n\n${r.brief}`;
  if (cmd === 'series') return `✓ ${r.name} (${r.id}): ${r.platforms?.join(', ') || 'no platforms'}, ${r.postsPerDay}/day${r.paused ? ', paused' : ''}`;
  if (cmd === 'note') return `✓ Noted on ${r.name}.`;
  if (cmd === 'stats' && Array.isArray(r)) return r.map((x) => `${x.id} ${x.title}: ${Object.entries(x.posts).map(([p, s]) => `${p} ${s.stats?.views ?? '?'} views, ${s.stats?.likes ?? '?'} likes${s.error ? ` (${s.error})` : ''}`).join(' · ')}`).join('\n');
  if (r?.id && r?.status) return `✓ ${r.id} [${r.status}] ${r.title}${r.review ? ` · ${r.review}` : ''}${Object.keys(r.posts ?? {}).length ? ` · ${Object.entries(r.posts).map(([p, s]) => `${p}: ${s.url ?? s.error ?? 'posted'}`).join(' · ')}` : ''}`;
  return JSON.stringify(r, null, 2);
}

// --- MCP ------------------------------------------------------------------------------------------

const MCP_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const S = (description) => ({ type: 'string', description });

export const TOOLS = [
  { name: 'reels_status', description: 'How the reels studio stands: each series (niche, platforms, schedule, its pipeline counts and the analyst\'s notes), every reel on the go with its id and status, the crew, and which voice/image services and platforms are set up.', inputSchema: obj({}), annotations: { readOnlyHint: true } },
  { name: 'reels_show', description: 'One reel in full: its script (scenes), caption, video file, review and posts.', inputSchema: obj({ reel: S('The reel id.') }, ['reel']), annotations: { readOnlyHint: true } },
  { name: 'reels_add_idea', description: 'Adds an idea for a reel to a series (the scout\'s job).', inputSchema: obj({ series: S('Series id or name.'), title: S('One specific story.'), hook: S('The first line that stops the scroll.'), idea: S('What it is about, for the writer.') }, ['series', 'title']) },
  {
    name: 'reels_script',
    description: 'Sends the script for an idea or a rejected reel (reel), or makes a new reel from it (series). 6-12 scenes, 110-170 words of narration in all; each visual is an image prompt without text or the art style.',
    inputSchema: obj({
      reel: S('The reel to script.'),
      series: S('Instead of reel: the series to make a new reel in.'),
      title: S('Its title.'),
      hook: S('The first line.'),
      scenes: { type: 'array', items: obj({ narration: S('What the narrator says.'), visual: S('The image prompt for it.') }, ['narration', 'visual']) },
      caption: S('What it posts with.'),
      hashtags: { type: 'array', items: { type: 'string' } },
    }, ['scenes', 'caption']),
  },
  { name: 'reels_review', description: 'Approves a rendered reel for posting, or rejects it with a note on what to fix (back to the writer). You cannot approve your own script.', inputSchema: obj({ reel: S('The reel id.'), approve: { type: 'boolean' }, note: S('What to fix (needed to reject).') }, ['reel', 'approve']) },
  { name: 'reels_remake', description: 'Makes a reel\'s video again (after its series\' music or style changed).', inputSchema: obj({ reel: S('The reel id.') }, ['reel']) },
  { name: 'reels_post', description: 'Posts an approved reel now, outside its schedule. Only when a person asks.', inputSchema: obj({ reel: S('The reel id.') }, ['reel']), annotations: { destructiveHint: false, openWorldHint: true } },
  { name: 'reels_stats', description: 'Fetches views, likes, comments and shares for every post.', inputSchema: obj({}), annotations: { openWorldHint: true } },
  { name: 'reels_note', description: 'Writes down a lesson from the numbers on a series, for the writer and scout.', inputSchema: obj({ series: S('Series id or name.'), text: S('One specific, actionable lesson.') }, ['series', 'text']) },
  {
    name: 'reels_series',
    description: 'Starts a series (no series given) or changes one: its niche, art style, voice, tone, music file, platforms, posts a day, backlog, call to action, hashtags, privacy, paused.',
    inputSchema: obj({
      series: S('The series to change; leave out to start one.'),
      name: S('Its name.'), niche: S('What its reels are about.'), style: S('The art style of every image.'), voice: S('The narrator\'s voice.'), tone: S('How the narrator reads.'), music: S('A track\'s file name in the studio\'s music folder.'),
      platforms: { type: 'array', items: { type: 'string', enum: ['tiktok', 'instagram', 'youtube'] } },
      postsPerDay: { type: 'number' }, backlog: { type: 'integer' }, cta: S('Ends every caption.'), hashtags: { type: 'array', items: { type: 'string' } },
      tiktokPrivacy: { type: 'string', enum: ['SELF_ONLY', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'PUBLIC_TO_EVERYONE'] }, youtubePrivacy: { type: 'string', enum: ['private', 'unlisted', 'public'] }, paused: { type: 'boolean' },
    }),
  },
  { name: 'reels_join_crew', description: 'Joins the reels crew yourself, in a role, and returns your brief.', inputSchema: obj({ role: { type: 'string', enum: ROLES }, series: S('The one series to work on; all of them when left out.') }, ['role']) },
  { name: 'reels_hire_crew', description: 'Hires a worker for each crew role (scout, writer, editor, analyst) nobody has yet.', inputSchema: obj({ series: S('The one series they work on.'), roles: { type: 'array', items: { type: 'string', enum: ROLES } }, provider: S('Which agent runs them.'), model: S('A model.'), effort: S('Reasoning effort.') }) },
];

/** A tool's arguments as a call to the studio. */
export function toolCall(name, a) {
  switch (name) {
    case 'reels_status': return { cmd: 'status', method: 'GET', path: '' };
    case 'reels_show': return { cmd: 'show', method: 'GET', path: '/reel', query: { id: a.reel } };
    case 'reels_add_idea': return { cmd: 'idea', method: 'POST', path: '/idea', body: a };
    case 'reels_script': return { cmd: 'script', method: 'POST', path: '/script', body: a };
    case 'reels_review': return { cmd: 'review', method: 'POST', path: '/review', body: a };
    case 'reels_remake': return { cmd: 'remake', method: 'POST', path: '/remake', body: a };
    case 'reels_post': return { cmd: 'post', method: 'POST', path: '/post', body: a };
    case 'reels_stats': return { cmd: 'stats', method: 'POST', path: '/stats', body: {} };
    case 'reels_note': return { cmd: 'note', method: 'POST', path: '/note', body: a };
    case 'reels_series': return { cmd: 'series', method: 'POST', path: a.series ? '/series/set' : '/series', body: a };
    case 'reels_join_crew': return { cmd: 'crew', method: 'POST', path: '/crew/join', body: a };
    case 'reels_hire_crew': return { cmd: 'crew', method: 'POST', path: '/crew', body: a };
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

export async function handleMcp(msg, io) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return msg && typeof msg === 'object' && 'id' in msg && !('method' in msg) ? undefined : { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid request' } };
  }
  if (!('id' in msg)) return undefined;
  const ok = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return ok({
        protocolVersion: MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'agent-office-reels', title: 'Agent Office reels studio', version: '1.0.0' },
        instructions: 'The reels studio of Agent Office: a faceless short-video page run by a crew of agents. Use these tools (or the office-reels command) for anything about the reels, series, crew or posts.',
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const name = msg.params?.name;
      if (!TOOLS.some((t) => t.name === name)) return { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `Unknown tool: ${name}` } };
      try {
        const c = toolCall(name, msg.params?.arguments ?? {});
        const r = await call(c, io);
        return ok({ content: [{ type: 'text', text: c.cmd === 'status' || c.cmd === 'show' ? JSON.stringify(r, null, 1) : formatResult(c.cmd, r) }] });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: e.message }], isError: true });
      }
    }
    default:
      return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
  }
}

function serveMcp(io, stdin, stdout) {
  return new Promise((resolve) => {
    const lines = createInterface({ input: stdin, crlfDelay: Infinity });
    const pending = new Set();
    lines.on('line', (line) => {
      if (!line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
        return;
      }
      const p = handleMcp(msg, io).catch((e) => ({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32603, message: e.message } }));
      pending.add(p);
      void p.then((res) => res && stdout.write(`${JSON.stringify(res)}\n`)).finally(() => pending.delete(p));
    });
    lines.on('close', () => void Promise.allSettled([...pending]).then(() => resolve()));
  });
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

export async function main(argv, io = {}) {
  const env = io.env ?? process.env;
  const stdin = io.stdin ?? process.stdin;
  const out = io.out ?? ((s) => process.stdout.write(s + '\n'));
  const err = io.err ?? ((s) => process.stderr.write(s + '\n'));
  const ctx = { env, fetch: io.fetch ?? fetch };
  try {
    const c = parseArgs(argv);
    if (c.cmd === 'help') {
      out(USAGE);
      return 0;
    }
    if (c.cmd === 'mcp') {
      await serveMcp(ctx, stdin, io.stdout ?? process.stdout);
      return 0;
    }
    officeEnv(env);
    if (c.stdin) {
      if (stdin.isTTY) throw new UsageError(`${c.cmd} reads ${c.stdin === 'json' ? 'JSON' : 'its text'} on stdin: office-reels ${c.cmd} … <<'EOF' … EOF`);
      const text = (await readStdin(stdin)).trim();
      if (c.stdin === 'text') c.body.text = text;
      else {
        try {
          Object.assign(c.body, JSON.parse(text || '{}'));
        } catch (e) {
          throw new UsageError(`That isn't JSON: ${e.message}`);
        }
      }
    }
    const r = await call(c, ctx);
    if (c.json) out(JSON.stringify(r, null, 2));
    else if (c.cmd === 'status' || c.cmd === 'ls') out(formatStatus(r, c.series));
    else if (c.cmd === 'show') out(JSON.stringify(r, null, 2));
    else if (c.cmd === 'brief') out(r.brief);
    else out(formatResult(c.cmd, r));
    return 0;
  } catch (e) {
    err(`office-reels: ${e.message}`);
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
