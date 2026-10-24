import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';
import type { DomainCheck, DomainTarget } from '../../shared/domain-monitor.js';
import { hostnameValid } from './cloudflare.js';
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
  }
  if (isIP(address) !== 6) return false;
  // Conservative global-unicast allowlist excludes mapped/private/tunnel/documentation ranges.
  const v = address.toLowerCase(); return /^[23][0-9a-f]{3}:/.test(v) && !v.startsWith('2001:') && !v.startsWith('2002:');
}
export function classify(http: number): DomainCheck['status'] {
  return http >= 200 && http < 300 ? 'reachable' : http >= 300 && http < 400 ? 'redirect' : http === 401 || http === 403 ? 'restricted' : http >= 400 ? 'error' : 'unknown';
}
export async function probeDomain(target: DomainTarget, signal?: AbortSignal): Promise<DomainCheck> {
  const started = Date.now(), checkedAt = new Date().toISOString(), base = { ...target, checkedAt };
  if (!hostnameValid(target.hostname)) return { ...base, status: 'unknown', latencyMs: 0, issue: 'Invalid hostname; probe refused.' };
  try {
    signal?.throwIfAborted(); let timer: NodeJS.Timeout | undefined;
    const addresses = await Promise.race([lookup(target.hostname, { all: true, verbatim: true }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('DNS_TIMEOUT')), 4000); })]).finally(() => clearTimeout(timer));
    if (!addresses.length || addresses.some(a => !publicAddress(a.address))) return { ...base, status: 'unknown', latencyMs: Date.now() - started, issue: 'Private/special DNS address; probe refused.' };
    const address = addresses.find(a => a.family === 4) ?? addresses[0];
    return await new Promise<DomainCheck>((resolve) => {
      let settled = false;
      const finish = (value: Partial<DomainCheck> & Pick<DomainCheck, 'status'>) => { if (settled) return; settled = true; resolve({ ...base, latencyMs: Date.now() - started, ...value }); };
      const deadline = AbortSignal.timeout(Math.max(100, 8000 - (Date.now() - started)));
      const request = https.get({ hostname: target.hostname, port: 443, path: '/', family: address.family,
        lookup: (_host, _options, callback) => callback(null, address.address, address.family),
        rejectUnauthorized: true, signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
        headers: { 'user-agent': 'Agent-Office-domain-monitor/1.0', accept: 'text/html,application/json;q=0.9,*/*;q=0.5' },
      }, response => {
        const http = response.statusCode ?? 0, status = classify(http), rawRay = String(response.headers['cf-ray'] ?? '');
        const ray = /^[a-z0-9-]{10,50}$/i.test(rawRay) ? rawRay : undefined;
        let body = '', bytes = 0;
        const done = () => {
          const cf = /(?:error\s*(?:code\s*[:=]?\s*)?|cf-error-code[^>]*>\s*)(1\d{3})\b/i.exec(body)?.[1];
          finish({ http, status: cf ? 'error' : status, ray, cloudflareError: cf, issue: cf ? 'Cloudflare error ' + cf : status === 'redirect' ? 'HTTP redirect; destination not probed.' : status === 'restricted' ? 'Authentication, Access or challenge; application health unknown.' : status === 'error' ? 'HTTP ' + http : undefined });
        };
        response.on('data', (chunk: Buffer) => { bytes += chunk.length; if (body.length < 16384) body += chunk.toString('utf8').slice(0, 16384 - body.length); if (bytes >= 16384) { done(); response.destroy(); } });
        response.on('end', done); response.on('close', done); response.on('error', () => finish({ status: 'error', issue: 'HTTP response interrupted.' }));
      });
      request.on('error', (error: NodeJS.ErrnoException) => finish({ status: 'error', issue: 'DNS/TLS/network failure (' + String(error.code ?? 'NETWORK').replace(/[^A-Z0-9_]/g, '').slice(0, 50) + ').' }));
    });
  } catch { return { ...base, status: 'error', latencyMs: Date.now() - started, issue: 'DNS failure or timeout.' }; }
}
