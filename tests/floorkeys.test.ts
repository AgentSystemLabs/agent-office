import test from 'node:test';
import assert from 'node:assert/strict';
import type { Ctx } from '../src/client/core/context.js';
import { Keys } from '../src/client/core/registry.js';
import { installFloorKeys } from '../src/client/features/floorkeys/index.js';
import type { FloorInfo } from '../src/shared/protocol.js';
import { store } from '../src/client/state/index.js';

const floor = (id: string) => ({ id, name: id, waiting: 0, people: 0, palette: 0 }) as FloorInfo;
const press = (code: string, shiftKey: boolean) => ({ code, key: '', shiftKey, repeat: false, preventDefault() {} }) as unknown as KeyboardEvent;

test('Shift and a digit go straight to that floor, numbered from the bottom up; the digit alone does not', () => {
  const keys = new Keys<KeyboardEvent>();
  const went: string[] = [];
  installFloorKeys({ keys } as unknown as Ctx, { switchFloor: (id) => went.push(id) });
  store.floors = [floor('api'), floor('web'), floor('admin')];
  assert.equal(keys.handle(press('Digit2', true)), 'bound');
  assert.equal(keys.handle(press('Digit3', true)), 'bound');
  assert.deepEqual(went, ['web', 'admin']);
  assert.equal(keys.handle(press('Digit1', false)), 'claimed');
  assert.equal(keys.handle(press('Digit0', true)), null);
  assert.deepEqual(went, ['web', 'admin']);
});
