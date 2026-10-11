import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { OperatorClient } from './mcp.js';
const exec = promisify(execFile);
const adb = async (...args: string[]) => (await exec(process.env.ADB ?? 'adb', args, { windowsHide: true, timeout: 8000, maxBuffer: 256000 })).stdout.trim();
export async function runBridge(argv = process.argv.slice(2)) {
  const [office, floor, run] = argv;
  if (!office || !floor || !run) throw new Error('Aufruf: office-xr <Office-URL> <Etage> <Testlauf>');
  const url = new URL('/api/playtests/xr-bridge', office);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Office benötigt HTTPS (außer localhost)');
  if (url.username || url.password) throw new Error('Keine Zugangsdaten in der URL');
  url.searchParams.set('floor', floor); url.searchParams.set('run', run);
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const token = (process.env.OFFICE_XR_TOKEN || await input.question('Kopplungscode aus der Playtest-Checkliste: ')).trim(); input.close();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Ungültiger Kopplungscode');
  const bridgeId = randomUUID(), connections = new Map<string, { port: string; client: OperatorClient }>();
  let selected: string[] = [], stopping = false;
  const results = new Map<string, { id: string; error?: string; message?: string; png?: string }>();
  const completed = new Set<string>();
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  async function disconnect(serial: string) {
    const c = connections.get(serial); if (!c) return;
    c.client.close(); connections.delete(serial);
    await adb('-s', serial, 'forward', '--remove', `tcp:${c.port}`).catch(() => {});
  }
  try {
    console.log('Verbinde Testbegleitung. Headsets anschließend im Office auswählen. Strg+C beendet den Helfer.');
    while (!stopping) {
      try {
        const lines = (await adb('devices', '-l')).split(/\r?\n/).slice(1);
        const devices = lines.map(line => line.trim().split(/\s+/)).filter(parts => parts.length > 1 && parts[1] !== 'no')
          .map(parts => ({ serial: parts[0], name: parts.find(p => p.startsWith('model:'))?.slice(6).replace(/_/g, ' ') || parts[0], status: parts[1] }));
        const snapshots: Record<string, unknown> = {};
        const received: Record<string, number> = {};
        for (const serial of [...connections.keys()]) if (!selected.includes(serial) || !devices.some(d => d.serial === serial && d.status === 'device')) await disconnect(serial);
        // At most two devices; read them concurrently to keep the sampling window small.
        await Promise.all(selected.map(async serial => {
          const device = devices.find(d => d.serial === serial); if (!device || device.status !== 'device') return;
          try {
            let c = connections.get(serial);
            if (!c) {
              const port = await adb('-s', serial, 'forward', 'tcp:0', 'tcp:8720');
              if (!/^\d+$/.test(port)) throw new Error('ADB-Portweiterleitung fehlgeschlagen');
              c = { port, client: new OperatorClient(`http://127.0.0.1:${port}`) }; connections.set(serial, c);
              await c.client.connect();
            }
            const start = Date.now(), sample = await c.client.call('ZRB_PlaytestSnapshot');
            if (Date.now() - start > 3000) throw new Error('Headset-Daten zu alt');
            snapshots[serial] = sample;
            received[serial] = Date.now();
          } catch (e) { device.status = (e as Error).message.slice(0, 290); await disconnect(serial); }
        }));
        for (const serial of Object.keys(snapshots)) if (Date.now() - received[serial] > 3000) delete snapshots[serial];
        const uploading = [...results.values()].slice(-1);
        const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ bridgeId, devices, snapshots, results: uploading }), signal: AbortSignal.timeout(8000), redirect: 'error' });
        const result = await response.json();
        if (!response.ok) { if ([401, 403, 404, 409].includes(response.status)) stopping = true; throw new Error(result.error || `Office HTTP ${response.status}`); }
        selected = result.selected;
        for (const r of uploading) results.delete(r.id);
        // Keep completed IDs locally: network retries must never repeat a preparation action.
        for (const command of result.commands ?? []) {
          if (completed.has(command.id) || !selected.includes(command.device) || !(command.expiresInMs > 0)) continue;
          completed.add(command.id);
          try {
            const current = snapshots[command.device] as { appSession?: string; context?: { build?: string } } | undefined;
            if (!current || current.appSession !== command.appSession || current.context?.build !== command.build) throw new Error('App-Sitzung oder Build gewechselt; Geräteaktion verworfen');
            if (command.kind === 'screenshot') {
              const capture = await exec(process.env.ADB ?? 'adb', ['-s', command.device, 'exec-out', 'screencap', '-p'], { windowsHide: true, timeout: 10000, maxBuffer: 12000000, encoding: 'buffer' });
              results.set(command.id, { id: command.id, png: capture.stdout.toString('base64'), message: 'Screenshot vom gewählten Headset' });
            } else if (command.kind === 'reserve-ammo') {
              const c = connections.get(command.device); if (!c) throw new Error('Headset getrennt');
              const prepared = await c.client.call('ZRB_PlaytestPrepare', { payload: JSON.stringify({ id: command.id, action: 'reserve-ammo', confirmed: true, appSession: command.appSession, build: command.build }) });
              if (!prepared.ok) throw new Error(prepared.error || 'Testvorbereitung abgelehnt');
              results.set(command.id, { id: command.id, message: prepared.message });
            }
          } catch (e) { results.set(command.id, { id: command.id, error: (e as Error).message.slice(0, 500) }); }
        }
        await Promise.all([...connections].map(async ([serial, c]) => {
          try { await c.client.call('ZRB_PlaytestOverlay', { payload: JSON.stringify(result.overlays?.[serial] ?? { status: 'stopped' }) }); }
          catch { await disconnect(serial); }
        }));
        if (result.stopped) stopping = true;
      } catch (e) { console.error((e as Error).message); }
      if (!stopping) await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } finally {
    await Promise.all([...connections].map(async ([serial, c]) => {
      await c.client.call('ZRB_PlaytestOverlay', { payload: '{"status":"stopped"}' }).catch(() => {}); await disconnect(serial);
    }));
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
