import { pathToFileURL } from 'node:url';
import { HELP, validExport } from './relay.mjs';

export function connectorConfig(env) {
  const relay = new URL(env.TELEGRAM_RELAY_URL);
  if (relay.protocol !== 'https:' || relay.username || relay.password || relay.pathname !== '/' || relay.search || relay.hash) throw new Error('Relay must be an HTTPS origin');
  const office = new URL(env.AGENT_OFFICE_TELEGRAM_OFFICE_URL ?? 'http://127.0.0.1:4600');
  if (office.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(office.hostname) || office.username || office.password || office.pathname !== '/' || office.search || office.hash) throw new Error('Office connector must use a loopback HTTP origin');
  if (![env.TELEGRAM_RELAY_TOKEN, env.AGENT_OFFICE_TELEGRAM_LOCAL_TOKEN].every((v) => typeof v === 'string' && v.length >= 32)) throw new Error('Configure separate relay and office tokens');
  return { relay: relay.origin, office: office.origin, relayToken: env.TELEGRAM_RELAY_TOKEN, localToken: env.AGENT_OFFICE_TELEGRAM_LOCAL_TOKEN };
}

export async function request(origin, token, route, data, binary = false) {
  const response = await fetch(origin + route, {
    method: data ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${token}`, ...(data ? { 'content-type': 'application/json' } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  if (!response.ok) throw new Error(`Connector endpoint unavailable (${response.status})`);
  return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
}

export async function processJob(config, job, call = request) {
  const local = (route, data, binary) => call(config.office, config.localToken, '/api/telegram/' + route, data, binary);
  const remote = (route, data) => call(config.relay, config.relayToken, '/connector/' + route, data);
  let text = '', files = [];
  const c = job.command;
  if (c.kind === 'help') text = HELP;
  else if (c.kind === 'status') {
    const s = await local('status');
    text = `ARTIQ STUDIO • Posting OFF\n${s.workers.map((w) => `${w.name}: ${w.status}`).join('\n')}`;
  } else if (c.kind === 'ask') {
    if (job.status === 'queued') {
      const result = await local('prompt', { id: job.id, brand: c.brand, text: c.text });
      if (result.status === 'needs_input') return remote('complete', { id: job.id, text: 'Pixel sedang menunggu jawaban atau izin di terminal Office lokal. Selesaikan lewat Office; bot tidak dapat menjawab atau menyetujui izin tersebut. Kirim instruksi lagi setelah Pixel siap.', files: [] });
      if (result.status === 'uncertain') return remote('complete', { id: job.id, text: 'Pengiriman ke Pixel belum bisa dipastikan. Cek kantor sebelum mengirim ulang instruksi.', files: [] });
      if (result.status !== 'accepted') throw new Error('Instruction rejected');
      await remote('wait', { id: job.id });
    }
    const { reply } = await local(`reply?id=${encodeURIComponent(job.id)}`);
    if (!reply) return { status: 'waiting_reply' };
    if (reply.brand_id !== c.brand) throw new Error('Reply brand differs');
    text = reply.text; files = reply.files;
  } else if (c.kind === 'report') {
    let campaign = c.campaign;
    if (!campaign) {
      const { campaigns } = await local(`reports?brand=${encodeURIComponent(c.brand)}`);
      if (campaigns.length !== 1) return remote('complete', { id: job.id, text: campaigns.length ? `Pilih report ${c.brand}:\n${campaigns.map((name) => `/report ${c.brand} ${name}`).join('\n')}` : `Belum ada report.md untuk ${c.brand}.`, files: [] });
      campaign = campaigns[0];
    }
    text = `${c.brand} / ${campaign} • report`;
    files = [`.agent-office/artiq-studio/brands/${c.brand}/reports/${campaign}/report.md`];
  } else if (c.kind === 'design') {
    text = `${c.brand} / ${c.campaign} / ${c.version} • draft, owner review diperlukan; Posting OFF`;
    const base = `.agent-office/artiq-studio/brands/${c.brand}/results/${c.campaign}/${c.version}`;
    files = [`${base}/preview-mobile360.png`, `${base}/feed-1080x1350.png`, `${base}/copy.md`];
  } else if (c.kind === 'file') { text = c.file; files = [c.file]; }
  else throw new Error('Unknown job');
  const attachments = [];
  let totalBytes = 0;
  for (const file of files) {
    if (!validExport(file)) throw new Error('Export forbidden');
    const bytes = await local(`export?path=${encodeURIComponent(file)}`, undefined, true);
    totalBytes += bytes.length;
    if (totalBytes > 8 * 1024 * 1024) throw new Error('Combined exports exceed 8 MB; request files separately');
    attachments.push({ path: file, base64: bytes.toString('base64') });
  }
  return remote('complete', { id: job.id, text, files: attachments });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = connectorConfig(process.env);
  let stopped = false;
  process.on('SIGINT', () => { stopped = true; });
  process.on('SIGTERM', () => { stopped = true; });
  console.log('Telegram connector running; office remains local, posting OFF');
  while (!stopped) {
    try {
      const { jobs } = await request(config.relay, config.relayToken, '/connector/jobs');
      for (const job of jobs) {
        try { await processJob(config, job); }
        catch {
          // A failed ask may have reached the agent. Never retry it using a different ID.
          await request(config.relay, config.relayToken, '/connector/complete', {
            id: job.id, text: 'Permintaan belum dapat diselesaikan. Periksa koneksi Mac/kantor, brand, versi, atau file hasil. Jangan ulang instruksi sebelum mengecek status Pixel.', files: [],
          });
        }
      }
    } catch { console.error('Connector unavailable; check local office and relay configuration'); }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
