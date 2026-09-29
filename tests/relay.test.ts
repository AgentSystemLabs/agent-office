import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { relayRequest, tunneledPort } from '../src/server/relay.js';
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
