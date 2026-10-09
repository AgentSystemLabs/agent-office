import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const HELP = 'ARTIQ STUDIO • Posting OFF\n/status\n/ask <brand> <instruksi>\n/report <brand> <campaign>\n/design <brand> <campaign> <vNN>\n/file <path export campaign>\nContoh: /design viniela-design feed-design-test-20261008 v06';
const slug = /^[a-z0-9][a-z0-9-]{0,79}$/;
export function parseCommand(text) {
  if (typeof text !== 'string' || text.length > 12000) return null;
  const [raw, ...parts] = text.trim().split(/\s+/);
  const cmd = raw?.split('@')[0].toLowerCase();
  if (['/start', '/help'].includes(cmd)) return { kind: 'help' };
  if (cmd === '/status' && !parts.length) return { kind: 'status' };
  if (cmd === '/ask' && slug.test(parts[0]) && parts.length > 1) return { kind: 'ask', brand: parts[0], text: parts.slice(1).join(' ') };
  if (cmd === '/report' && parts.length === 2 && parts.every((p) => slug.test(p))) return { kind: 'report', brand: parts[0], campaign: parts[1] };
  if (cmd === '/design' && parts.length === 3 && parts.slice(0, 2).every((p) => slug.test(p)) && /^v[0-9]{2,}$/.test(parts[2])) return { kind: 'design', brand: parts[0], campaign: parts[1], version: parts[2] };
  if (cmd === '/file' && parts.length === 1 && validExport(parts[0])) return { kind: 'file', file: parts[0] };
  return null;
}

export function validExport(value) {
  if (typeof value !== 'string' || value.includes('\\')) return false;
  const p = value.split('/');
  return p[0] === '.agent-office' && p[1] === 'artiq-studio' && p[2] === 'brands' && slug.test(p[3]) &&
    ['reports', 'results'].includes(p[4]) && slug.test(p[5]) &&
    (p[4] === 'reports' ? p.length === 7 : p.length === 8 && /^v[0-9]{2,}$/.test(p[6])) &&
    /^(report|review|copy|strategy|delivery-notes|export-manifest|sources|design-review-v[0-9]+|feed-1080x1350|preview-mobile360|feed-editable)\.(md|json|png|svg|pdf)$/.test(p.at(-1));
}

export function sameSecret(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || expected.length < 32) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authorizedUpdate(update, config) {
  const m = update?.message;
  return Number.isSafeInteger(update?.update_id) && update.update_id >= 0 && m?.chat?.type === 'private' &&
    !m.from?.is_bot && String(m.from?.id) === config.userId && String(m.chat?.id) === config.chatId && typeof m.text === 'string';
}

export async function telegram(token, method, body) {
  const multipart = body instanceof FormData;
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      ...(multipart ? {} : { headers: { 'content-type': 'application/json' } }), body: multipart ? body : JSON.stringify(body),
    });
  } catch { throw new Error('Telegram transport unavailable'); }
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(`Telegram ${method} failed (${response.status})`);
  return result.result;
}

export function configFrom(env) {
  const config = { token: env.TELEGRAM_BOT_TOKEN, secret: env.TELEGRAM_WEBHOOK_SECRET, relayToken: env.TELEGRAM_RELAY_TOKEN,
    userId: env.TELEGRAM_ALLOWED_USER_ID, chatId: env.TELEGRAM_ALLOWED_CHAT_ID, dataDir: env.TELEGRAM_DATA_DIR ?? './data' };
  if (!config.token || !/^[0-9]+:[A-Za-z0-9_-]+$/.test(config.token)) throw new Error('Configure TELEGRAM_BOT_TOKEN');
  if (![config.secret, config.relayToken].every((v) => typeof v === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(v))) throw new Error('Configure separate webhook and relay secrets (32+ characters)');
  if (!/^[1-9][0-9]*$/.test(config.userId) || config.chatId !== config.userId) throw new Error('Configure the same private owner ID in TELEGRAM_ALLOWED_USER_ID and TELEGRAM_ALLOWED_CHAT_ID');
  if (config.secret === config.relayToken) throw new Error('Webhook and relay secrets must differ');
  return config;
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body));
}
async function body(req, limit = 12 * 1024 * 1024) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

/** One relay instance and a persistent private data directory. No terminal or public file server. */
export function createRelay(config, api = (method, data) => telegram(config.token, method, data)) {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const stateFile = path.join(config.dataDir, 'queue.json');
  let state = { jobs: [], seen: [], lastSeenAt: null };
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw new Error('Relay queue unreadable; refusing to discard it'); }
  const save = () => {
    const tmp = `${stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 }); fs.renameSync(tmp, stateFile);
  };
  let completing = false;
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://relay');
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'telegram-relay', posting: 'OFF' });
      if (req.method === 'POST' && url.pathname === '/telegram/webhook') {
        if (!sameSecret(req.headers['x-telegram-bot-api-secret-token'], config.secret)) return json(res, 403, { error: 'Forbidden' });
        const update = await body(req, 64 * 1024);
        if (!authorizedUpdate(update, config)) return json(res, 200, { ok: true });
        if (state.seen.includes(update.update_id)) return json(res, 200, { ok: true });
        const command = parseCommand(update.message.text) ?? { kind: 'help' };
        if (state.jobs.filter((j) => j.status !== 'completed').length >= 64) return json(res, 503, { error: 'Queue full' });
        // Persist before acknowledging the webhook. Telegram retries cannot duplicate instructions.
        state.jobs.push({ id: `tg-${update.update_id}`, command, status: 'queued', at: new Date().toISOString() });
        state.seen.push(update.update_id); state.seen = state.seen.slice(-2048);
        save();
        return json(res, 200, { ok: true });
      }
      if (!url.pathname.startsWith('/connector/') || !sameSecret(req.headers.authorization, `Bearer ${config.relayToken}`)) return json(res, 403, { error: 'Forbidden' });
      if (req.method === 'GET' && url.pathname === '/connector/jobs') {
        state.lastSeenAt = new Date().toISOString(); save();
        return json(res, 200, { jobs: state.jobs.filter((j) => j.status === 'queued' || j.status === 'waiting_reply').slice(0, 10) });
      }
      if (req.method === 'POST' && url.pathname === '/connector/wait') {
        const input = await body(req, 1024); const job = state.jobs.find((j) => j.id === input.id);
        if (!job) return json(res, 404, { error: 'No job' });
        if (job.status === 'queued') { job.status = 'waiting_reply'; save(); }
        return json(res, 200, { status: job.status });
      }
      if (req.method === 'POST' && url.pathname === '/connector/complete') {
        const input = await body(req); const job = state.jobs.find((j) => j.id === input.id);
        if (!job) return json(res, 404, { error: 'No job' });
        if (['completed', 'uncertain'].includes(job.status)) return json(res, 200, { status: job.status });
        if (completing || job.status === 'sending') return json(res, 409, { error: 'Delivery in progress or uncertain; do not resend' });
        if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 12000 || !Array.isArray(input.files) || input.files.length > 5) return json(res, 400, { error: 'Invalid response' });
        const files = input.files.map((f) => {
          if (!validExport(f.path) || typeof f.base64 !== 'string' || f.base64.length > 11200000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(f.base64)) throw new Error('Invalid export');
          if (job.command.brand && f.path.split('/')[3] !== job.command.brand) throw new Error('Cross-brand export');
          const bytes = Buffer.from(f.base64, 'base64');
          if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('Export too large');
          return { ...f, bytes };
        });
        if (files.reduce((n, f) => n + f.bytes.length, 0) > 8 * 1024 * 1024) return json(res, 400, { error: 'Combined exports exceed 8 MB' });
        // Persist before sending: an ambiguous network error must never send the same file twice automatically.
        completing = true; job.status = 'sending'; save();
        try {
          for (let i = 0; i < input.text.length; i += 3500) await api('sendMessage', { chat_id: config.chatId, text: input.text.slice(i, i + 3500) });
          for (const file of files) {
            const name = file.path.split('/').at(-1);
            const form = new FormData(); form.set('chat_id', config.chatId);
            // Mobile PNG as a visible preview; full resolution remains an uncompressed document.
            const photo = name === 'preview-mobile360.png';
            form.set(photo ? 'photo' : 'document', new Blob([file.bytes], { type: photo ? 'image/png' : 'application/octet-stream' }), name);
            form.set('caption', file.path.slice(-900));
            await api(photo ? 'sendPhoto' : 'sendDocument', form);
          }
          job.status = 'completed';
        } catch { job.status = 'uncertain'; }
        finally { completing = false; save(); }
        // Trim completed history, retaining all unfinished/uncertain work for diagnosis.
        const completed = state.jobs.filter((j) => j.status === 'completed').slice(-100);
        state.jobs = [...state.jobs.filter((j) => j.status !== 'completed'), ...completed]; save();
        return json(res, 200, { status: job.status });
      }
      return json(res, 404, { error: 'Not found' });
    } catch { if (!res.headersSent) json(res, 400, { error: 'Invalid request or unavailable storage' }); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = configFrom(process.env);
  const server = createRelay(config);
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, '0.0.0.0', () => console.log(`Telegram relay listening on ${port}; posting OFF`));
}
