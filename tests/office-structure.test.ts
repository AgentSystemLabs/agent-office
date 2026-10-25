import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OfficeStructureStore, MAIN_ENGINEERING } from '../src/server/office-structure.js';

function setup(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-zones-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const floors = [{ id: 'old-project' }];
  const building = { list: () => floors };
  return { dir, floors, building };
}

test('defaults are created once and legacy floors resolve to main engineering without changing floors.json', (t) => {
  const { dir, building } = setup(t);
  const old = '[{"id":"old-project"}]';
  writeFileSync(path.join(dir, 'floors.json'), old);
  const first = new OfficeStructureStore(dir, building);
  const saved = readFileSync(path.join(dir, 'zones.json'), 'utf8');
  assert.deepEqual(first.snapshot().zones.map((z) => z.id), ['training', 'main']);
  assert.equal(first.snapshot().departments.length, 18);
  assert.equal(first.snapshot().floorDepartments['old-project'], MAIN_ENGINEERING);
  new OfficeStructureStore(dir, building);
  assert.equal(readFileSync(path.join(dir, 'zones.json'), 'utf8'), saved);
  assert.equal(readFileSync(path.join(dir, 'floors.json'), 'utf8'), old);
});

test('department assignments survive restart and removed floors disappear from the view', (t) => {
  const { dir, building, floors } = setup(t);
  const first = new OfficeStructureStore(dir, building);
  assert.equal(first.assignFloor('old-project', 'training-incubator'), undefined);
  assert.equal(new OfficeStructureStore(dir, building).snapshot().floorDepartments['old-project'], 'training-incubator');
  floors.length = 0;
  assert.deepEqual(new OfficeStructureStore(dir, building).snapshot().floorDepartments, {});
});

test('department creation validates slug uniqueness and unknown assignment', (t) => {
  const { dir, building } = setup(t);
  const office = new OfficeStructureStore(dir, building);
  const input = { zoneId: 'main', slug: 'quality', name: 'Quality', color: '#123456' };
  assert.equal(office.addDepartment(input), undefined);
  assert.match(office.addDepartment(input) ?? '', /already exists/);
  assert.equal(office.assignFloor('old-project', 'missing'), 'Unknown or disabled department');
  assert.equal(office.snapshot().departments.filter((d) => d.id === 'quality').length, 1);
  const saved = JSON.parse(readFileSync(path.join(dir, 'zones.json'), 'utf8'));
  assert.equal(saved.data.audit[0].action, 'department.add');
});

test('malformed metadata remains untouched and disables edits', (t) => {
  const { dir, building } = setup(t);
  const file = path.join(dir, 'zones.json');
  writeFileSync(file, '{broken');
  const office = new OfficeStructureStore(dir, building);
  assert.match(office.addDepartment({}) ?? '', /read-only/);
  assert.equal(readFileSync(file, 'utf8'), '{broken');
  assert.equal(office.snapshot().floorDepartments['old-project'], MAIN_ENGINEERING);
});
