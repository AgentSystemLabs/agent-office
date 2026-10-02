import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { relayRequest, tunneledPort, tunneledService } from '../src/server/relay.js';
import type { ServiceInfo } from '../src/shared/protocol.js';

const req = (host: string, extra: Record<string, string> = {}) => ({ headers: { host, ...extra } }) as unknown as http.IncomingMessage;
const TAILNET = 'agent-office.tail1234.ts.net';

test('a service tunnel names its port in the Host', () => {
  assert.equal(tunneledPort(req('localhost:5173'), 4600), 5173);
  assert.equal(tunneledPort(req('127.0.0.1:3000'), 4600), 3000);
  assert.equal(tunneledPort(req('localhost:4600'), 4600), undefined);
  assert.equal(tunneledPort(req('office.example.com'), 4600), undefined);
});

test("on the tailnet, <office>.ts.net:<port> is that worker's server, and the office's own name isn't", () => {
  assert.equal(tunneledPort(req(`${TAILNET}:5173`), 4600, TAILNET), 5173);
  assert.equal(tunneledPort(req(`AGENT-OFFICE.tail1234.ts.net:5173`), 4600, TAILNET), 5173);
  assert.equal(tunneledPort(req(TAILNET), 4600, TAILNET), undefined);
  // Another machine's name, or no tailnet at all.
  assert.equal(tunneledPort(req(`other.tail1234.ts.net:5173`), 4600, TAILNET), undefined);
  assert.equal(tunneledPort(req(`${TAILNET}:5173`), 4600), undefined);
  // Something the office relayed already never loops back.
  assert.equal(tunneledPort(req(`${TAILNET}:5173`, { 'x-agent-office-relay': '1' }), 4600, TAILNET), undefined);
});

test("the tunnel client names the port in a header, and never gets the office's own pages for it", () => {
  const svc = { port: 5173, host: '127.0.0.1' } as ServiceInfo;
  const lookup = (port: number) => (port === 5173 ? svc : port === 3000 ? 'gone' : undefined);
  const named = (port: string, host = 'office.example.com', extra: Record<string, string> = {}) => tunneledService(req(host, { 'x-agent-office-service': port, ...extra }), 4600, undefined, lookup);
  // Whatever address the office was reached at, the header says which server.
  assert.deepEqual(named('5173'), { port: 5173, svc });
  assert.deepEqual(named('5173', 'localhost:4600'), { port: 5173, svc });
  assert.deepEqual(named('5173', 'localhost:3000'), { port: 5173, svc });
  assert.deepEqual(named('3000'), { port: 3000, svc: 'gone' });
  // A port no worker serves, the office's own, or no port at all: stopped, not the office.
  assert.deepEqual(named('8080'), { port: 8080, svc: 'gone' });
  assert.deepEqual(named('4600', 'localhost:4600'), { port: 4600, svc: 'gone' });
  assert.deepEqual(named('nope'), { port: 0, svc: 'gone' });
  assert.deepEqual(named('99999999'), { port: 0, svc: 'gone' });
  // A worker's page can't get to the office by saying the office relayed it already.
  assert.deepEqual(named('5173', 'office.example.com', { 'x-agent-office-relay': '1' }), { port: 5173, svc });
  assert.deepEqual(named('8080', 'localhost:4600', { 'x-agent-office-relay': '1' }), { port: 8080, svc: 'gone' });

  // Without the header it goes by the Host, as a service tunnel does, and the office's own pages are its own.
  const hosted = (host: string) => tunneledService(req(host), 4600, undefined, lookup);
  assert.deepEqual(hosted('localhost:5173'), { port: 5173, svc });
  assert.deepEqual(hosted('localhost:3000'), { port: 3000, svc: 'gone' });
  assert.equal(hosted('localhost:8080'), undefined);
  assert.equal(hosted('localhost:4600'), undefined);
  assert.equal(hosted('office.example.com'), undefined);
});

test('from the tailnet, the worker\'s server gets a localhost Host and no office cookie', async () => {
  let seen: http.IncomingHttpHeaders = {};
  const upstream = http.createServer((r, res) => {
    seen = r.headers;
    res.end('hi');
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const port = (upstream.address() as AddressInfo).port;
  const svc = { port, host: '127.0.0.1' } as ServiceInfo;
  const office = http.createServer((r, res) => relayRequest(r, res, svc));
  await new Promise<void>((resolve) => office.listen(0, '127.0.0.1', resolve));
  try {
    const officePort = (office.address() as AddressInfo).port;
    const get = (host: string) =>
      new Promise<string>((resolve, reject) => {
        const headers = { host, cookie: 'ao_session=abc; theirs=1', 'x-forwarded-host': host, 'x-forwarded-proto': 'https' };
        http.get({ port: officePort, host: '127.0.0.1', path: '/x', headers }, (res) => {
          let body = '';
          res.on('data', (d) => (body += d)).on('end', () => resolve(body));
        }).on('error', reject);
      });

    assert.equal(await get(`${TAILNET}:${port}`), 'hi');
    assert.equal(seen.host, `localhost:${port}`);
    assert.equal(seen['x-forwarded-host'], `${TAILNET}:${port}`);
    assert.equal(seen.cookie, 'theirs=1');

    // Through an SSH tunnel it already is one, and stays as it was.
    await get(`127.0.0.1:${port}`);
    assert.equal(seen.host, `127.0.0.1:${port}`);
  } finally {
    office.close();
    upstream.close();
  }
});
