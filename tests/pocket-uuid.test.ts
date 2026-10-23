import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { uuid } from '../src/shared/uuid';

test('Pocket IDs remain valid UUIDs on HTTP LAN contexts without randomUUID', () => {
  const original=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  let calls=0;
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues:(bytes:Uint8Array)=>{bytes.fill(++calls);return bytes;}}});
  try {
    const a=uuid(); const b=uuid();
    assert.match(a,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(a,b);
    assert.equal(calls,2);
  } finally { if(original) Object.defineProperty(globalThis,'crypto',original); else Reflect.deleteProperty(globalThis,'crypto'); }
});

test('standalone extension host and bundled world use the same UUID fallback', () => {
  assert.equal(readFileSync(new URL('../src/shared/uuid.ts',import.meta.url),'utf8'),readFileSync(new URL('../integrations/pi-pocket/office-v2-client/uuid.js',import.meta.url),'utf8'));
});
