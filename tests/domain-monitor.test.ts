import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseProfile, hostnameValid, discover, collection, analytics, cloudflareRequest } from '../src/server/domain-monitor/cloudflare.js';
import { publicAddress, classify, probeDomain } from '../src/server/domain-monitor/probe.js';
import { DomainMonitor } from '../src/server/domain-monitor/index.js';
import { domainMonitorRoutes } from '../src/server/http/routes/domain-monitor.js';

const account = '1'.repeat(32), token = 'synthetic_profile_'.repeat(3);
test('profile accepts one credential, rejects missing or conflicting values without echoing them', () => {
  assert.deepEqual(parseProfile(`Authorization: Bearer ${token}\nhttps://api.cloudflare.com/client/v4/accounts/${account}/tokens/verify`), { token, account });
  for (const source of ['', `Bearer ${token}`, `Bearer ${token}\nBearer ${'different_'.repeat(5)}\n/accounts/${account}/`]) {
    assert.throws(() => parseProfile(source), e => e instanceof Error && !e.message.includes(token));
  }
});
test('hostname validation rejects URL/credential/control/wildcard injection', () => {
  for (const s of ['https://example.com', 'user:pass@example.com', 'example.com:443', '../example.com', '*.example.com', 'example.com\n', '-a.example.com']) assert.equal(hostnameValid(s), false, s);
  assert.ok(hostnameValid('www.example.com'));
});
test('public IP allowlist refuses local, special and IPv6 mapping/tunnel addresses', () => {
  for (const s of ['127.0.0.1', '10.2.3.4', '169.254.169.254', '100.100.100.200', '172.31.0.1', '192.168.0.2', '198.18.0.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::', 'not-ip']) assert.equal(publicAddress(s), false, s);
  assert.equal(publicAddress('1.1.1.1'), true); assert.equal(publicAddress('2606:4700:4700::1111'), true);
});
test('loopback HTTPS probe is refused before any HTTP request', async () => {
  const d = await probeDomain({ hostname: '127.0.0.1', workers: [], source: 'test' });
  assert.equal(d.status, 'unknown'); assert.match(d.issue!, /refused/); assert.equal(d.http, undefined);
});
test('HTTP categories do not represent auth or redirects as application health', () => {
  assert.deepEqual([200, 204, 301, 401, 403, 404, 503, 0].map(classify), ['reachable', 'reachable', 'redirect', 'restricted', 'restricted', 'error', 'error', 'unknown']);
});
test('live discovery replaces domain sets and maps route plus custom-domain Workers', async () => {
  let current = 'first.example.com';
  const api = async (route: string) => {
    let result: unknown[] = [];
    if (route.startsWith('/zones?')) result = [{ name: 'example.com', id: '2'.repeat(32) }];
    if (route.includes('/dns_records')) result = [{ name: current, type: 'A' }, { name: 'mail-secret.example.com', type: 'TXT', content: token }];
    if (route.includes('/workers/routes')) result = [{ pattern: current + '/*', script: 'gateway' }];
    if (route.includes('/workers/domains')) result = [{ hostname: current, service: 'origin' }];
    if (route.includes('/workers/scripts')) result = [{ id: 'gateway' }, { id: 'origin' }];
    if (route.includes('/pages/projects')) { assert.ok(route.includes('per_page=10')); result = [{ name: 'site', domains: ['site.pages.dev'] }]; }
    return { success: true, result, result_info: { total_pages: 1, page: 1 } };
  };
  const a = await discover(api, account); current = 'second.example.com'; const b = await discover(api, account);
  assert.deepEqual(a.targets.find(x => x.hostname === 'first.example.com')?.workers, ['gateway', 'origin']);
  assert.ok(b.targets.some(x => x.hostname === 'second.example.com')); assert.ok(!b.targets.some(x => x.hostname === 'first.example.com'));
  assert.ok(!JSON.stringify(a).includes(token)); assert.ok(!a.targets.some(x => x.hostname === 'mail-secret.example.com'));
});
test('collection follows actual pagination and fails on mismatch or API denial', async () => {
  let count = 0;
  const values = await collection(async () => ({ success: true, result: [{ n: ++count }], result_info: { page: count, total_pages: 2 } }), '/zones');
  assert.equal(values.length, 2);
  await assert.rejects(collection(async () => ({ success: true, result: [], result_info: { page: 2 } }), '/zones'), /pagination/);
  await assert.rejects(collection(async () => ({ success: false, result: null, errors: [{ message: token }] }), '/zones'), e => e instanceof Error && !e.message.includes(token));
});
test('capability failures remain visible rather than claiming complete coverage', async () => {
  const d = await discover(async () => { throw Error('Cloudflare API HTTP 403.'); }, account);
  assert.equal(d.targets.length, 0); assert.equal(d.issues.length, 4); assert.ok(d.issues.every(x => x.includes('403')));
});
test('analytics use fixed read-only query and retain request/error outcome counts', async () => {
  const result = await analytics(async (route, body) => {
    assert.equal(route, '/graphql'); assert.match(JSON.stringify(body), /workersInvocationsAdaptive/); assert.ok(!JSON.stringify(body).includes('mutation'));
    return { data: { viewer: { accounts: [{ workersInvocationsAdaptive: [
      { dimensions: { scriptName: 'worker', status: 'success' }, sum: { requests: 4, errors: 0 } },
      { dimensions: { scriptName: 'worker', status: 'exception' }, sum: { requests: 2, errors: 2 } },
    ] }] } }, errors: null };
  }, account);
  assert.deepEqual(JSON.parse(JSON.stringify(result.metrics)), [{ name: 'worker', requests: 6, errors: 2, outcomes: { success: 4, exception: 2 } }]);
});
test('analytics missing access is unknown and does not echo API errors', async () => {
  await assert.rejects(analytics(async () => ({ errors: [{ message: token }] }), account), e => e instanceof Error && !e.message.includes(token));
  await assert.rejects(analytics(async () => ({ data: { viewer: { accounts: [] } } }), account), /unavailable/);
  const result = await analytics(async () => ({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [] }] } } }), account);
  assert.deepEqual(result.metrics, []);
});
test('transport refuses writes, rejects redirects, bounds bodies and hides raw API errors', async () => {
  const fetchBefore = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => { assert.equal(init?.redirect, 'error'); return new Response(JSON.stringify({ error: token }), { status: 403 }); };
    const api = cloudflareRequest(token);
    await assert.rejects(api('/accounts/' + account + '/workers/scripts', {}), /refused/);
    await assert.rejects(api('https://evil.example/zones'), /refused/);
    await assert.rejects(api('/graphql', { query: 'mutation { unsafe }' }), /fixed read-only/);
    await assert.rejects(api('/zones'), e => e instanceof Error && e.message.includes('403') && !e.message.includes(token));
    globalThis.fetch = async () => new Response('x'.repeat(2 * 1024 * 1024 + 1));
    await assert.rejects(api('/zones'), /response limit/);
    globalThis.fetch = async () => new Response(token);
    await assert.rejects(api('/zones'), e => e instanceof Error && !e.message.includes(token));
  } finally { globalThis.fetch = fetchBefore; }
});
test('missing/disabled local configuration and stopped lifecycle are explicit; snapshots are copies', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'office-monitor-'));
  const monitor = new DomainMonitor(dir);
  try {
    await monitor.check(); assert.match(monitor.snapshot().issues.join(' '), /unavailable/);
    await writeFile(path.join(dir, 'cloudflare-monitor.json'), JSON.stringify({ enabled: false }));
    monitor.start(); monitor.start(); await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(monitor.snapshot().enabled, false); const s = monitor.snapshot(); s.issues.push(token); assert.ok(!monitor.snapshot().issues.includes(token));
    monitor.stop(); assert.equal(monitor.snapshot().running, false); assert.equal(domainMonitorRoutes.state.auth, 'session');
  } finally { monitor.stop(); await rm(dir, { recursive: true, force: true }); }
});
test('restoring removable-drive credentials triggers fresh discovery after a failure', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'office-monitor-recovery-')), fetchBefore = globalThis.fetch;
  const profile = path.join(dir, 'profile.txt'), monitor = new DomainMonitor(dir); let discoveries = 0;
  try {
    await writeFile(path.join(dir, 'cloudflare-monitor.json'), JSON.stringify({ enabled: true, credentialFile: profile }));
    const content = `Bearer ${token}\n/accounts/${account}/`;
    await writeFile(profile, content);
    globalThis.fetch = async url => {
      const route = String(url);
      if (route.includes('/graphql')) return Response.json({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [] }] } } });
      if (route.includes('/workers/scripts')) discoveries++;
      return Response.json({ success: true, result: [], result_info: { page: 1, total_pages: 1 } });
    };
    await monitor.check(); assert.equal(discoveries, 1);
    await rm(profile); await monitor.check(); assert.match(monitor.snapshot().issues.join(' '), /credential file unavailable/);
    await writeFile(profile, content); await monitor.check(); assert.equal(discoveries, 2);
    assert.ok(!JSON.stringify(monitor.snapshot()).includes(token));
  } finally { globalThis.fetch = fetchBefore; monitor.stop(); await rm(dir, { recursive: true, force: true }); }
});
