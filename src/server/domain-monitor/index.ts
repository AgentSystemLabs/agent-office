import { readFile, stat, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { DomainMonitorState, DomainTarget } from '../../shared/domain-monitor.js';
import { analytics, cloudflareRequest, discover, readProfile } from './cloudflare.js';
import { probeDomain } from './probe.js';
import type { Ctx } from '../office/context.js';
const INTERVAL = 60_000, DISCOVERY = 5 * 60_000;
export class DomainMonitor {
  private timer?: NodeJS.Timeout; private lastDiscovery = 0; private targets: DomainTarget[] = [];
  private controller = new AbortController();
  private state: DomainMonitorState = { enabled: false, running: false, location: 'Agent Office on this computer', intervalSeconds: 60, domains: [], workers: [], metrics: [], issues: ['Cloudflare monitoring not configured.'], checking: false };
  constructor(private readonly dataDir: string) {}
  snapshot(): DomainMonitorState { return structuredClone(this.state); }
  start() { if (this.timer) return; this.controller = new AbortController(); this.state.running = true; void this.check(); this.timer = setInterval(() => void this.check(), INTERVAL); this.timer.unref(); }
  stop() { clearInterval(this.timer); this.timer = undefined; this.controller.abort(); this.state.running = false; }
  async check() {
    if (this.state.checking) return; this.state.checking = true;
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(180_000)]);
    try {
      const file = path.join(this.dataDir, 'cloudflare-monitor.json');
      if ((await stat(file)).size > 8192) throw Error('Cloudflare monitoring configuration too large.');
      const cfg = JSON.parse(await readFile(file, 'utf8')) as { enabled?: unknown; credentialFile?: unknown };
      if (cfg.enabled !== true) { this.lastDiscovery = 0; this.state.enabled = false; this.state.domains = []; this.targets = []; this.state.issues = ['Cloudflare monitoring disabled.']; return; }
      if (typeof cfg.credentialFile !== 'string' || !path.isAbsolute(cfg.credentialFile)) throw Error('Configure an absolute Cloudflare credential file path locally.');
      this.state.enabled = true;
      const profile = await readProfile(cfg.credentialFile);
      if (Date.now() - this.lastDiscovery >= DISCOVERY) {
        this.lastDiscovery = Date.now(); const api = cloudflareRequest(profile.token, signal), discovery = await discover(api, profile.account);
        signal.throwIfAborted(); this.targets = discovery.targets; this.state.workers = discovery.workers;
        this.state.issues = discovery.issues; this.state.discoveredAt = new Date().toISOString();
        try { const a = await analytics(api, profile.account); this.state.metrics = a.metrics; this.state.analyticsFrom = a.from; this.state.analyticsTo = a.to; this.state.analyticsAt = new Date().toISOString(); }
        catch (e) { this.state.metrics = []; this.state.analyticsAt = undefined; this.state.issues.push(e instanceof Error ? e.message : 'Worker analytics unavailable.'); }
      }
      const checked = new Map<string, Awaited<ReturnType<typeof probeDomain>>>(); let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, this.targets.length) }, async () => {
        while (next < this.targets.length) { signal.throwIfAborted(); const target = this.targets[next++]; checked.set(target.hostname, await probeDomain(target, signal)); }
      }));
      signal.throwIfAborted(); this.state.domains = this.targets.map(t => checked.get(t.hostname)!).filter(Boolean);
      this.state.checkedAt = new Date().toISOString(); this.state.nextCheckAt = new Date(Date.now() + INTERVAL).toISOString();
      const output = path.join(this.dataDir, 'cloudflare-monitor-latest.json');
      await writeFile(output + '.tmp', JSON.stringify({ ...this.state, checking: false }), { mode: 0o600 }); await rename(output + '.tmp', output);
    } catch (e) {
      this.lastDiscovery = 0; this.targets = []; this.state.domains = []; this.state.metrics = []; this.state.analyticsAt = undefined;
      this.state.issues = [(e as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'Cloudflare monitor configuration or removable drive unavailable.' : e instanceof SyntaxError ? 'Cloudflare monitor configuration invalid.' : e instanceof Error ? e.message : 'Cloudflare monitoring unavailable.'];
      this.state.nextCheckAt = new Date(Date.now() + INTERVAL).toISOString();
    } finally { this.state.checking = false; }
  }
}
const monitors = new WeakMap<Ctx, DomainMonitor>();
export function monitorOf(ctx: Ctx) { let m = monitors.get(ctx); if (!m) { m = new DomainMonitor(ctx.cfg.dataDir); monitors.set(ctx, m); } return m; }
export function startDomainMonitor(ctx: Ctx): () => void { const m = monitorOf(ctx); m.start(); return () => m.stop(); }
