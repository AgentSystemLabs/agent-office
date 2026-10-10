import { test } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { officeDeliver } from '../src/server/hooks/office-deliver.js';
import type { Ctx } from '../src/server/office/context.js';

for (const [name, floor, expected] of [
  ['unknown worker', undefined, 401],
  ['wrong token', { workers: { authenticate: () => undefined } }, 401],
  ['ordinary desk cannot certify a complete issue', { workers: { authenticate: () => ({ deskId: 'desk-1' }) } }, 403],
  ['coordinator GET cannot mutate', { workers: { authenticate: () => ({ deskId: 'station-pulls' }) } }, 405],
] as const) {
  test(name, async () => {
    let status = 0;
    const ctx = { workerFloor: () => floor } as unknown as Ctx;
    const req = { method: 'GET', headers: { authorization: 'Bearer test' } } as http.IncomingMessage;
    const res = { writeHead(code: number) { status = code; return this; }, end() {} } as unknown as http.ServerResponse;
    await officeDeliver(ctx, req, res, new URL('http://localhost/office/deliver?worker=coordinator'));
    assert.equal(status, expected);
  });
}
