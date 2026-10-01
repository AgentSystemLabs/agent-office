import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MaintenanceBoard } from '../src/server/maintenance-board.js';

test('maintenance issues and detail use the office source even when the project has the same issue number', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'ao-maintenance-board-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'agent-office');
  const project = path.join(root, 'project');
  mkdirSync(source); mkdirSync(project);
  execFileSync('git', ['init', source]);
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:team/agent-office.git'], { cwd: source });
  execFileSync('git', ['remote', 'add', 'upstream', 'https://github.com/upstream/agent-office.git'], { cwd: source });
  const cli = path.join(root, 'gh');
  writeFileSync(cli, `#!${process.execPath}
const office = process.cwd().endsWith('/agent-office') && process.env.GH_REPO === 'team/agent-office';
const title = office ? 'Fix the maintenance closet' : 'Unrelated project issue';
const args = process.argv.slice(2);
if (args[0] === 'repo') console.log(JSON.stringify({nameWithOwner: office ? 'team/agent-office' : 'team/project'}));
else if (args[0] === 'issue' && args[1] === 'create') { require('node:fs').writeFileSync(process.cwd() + '/created.json', JSON.stringify({args, marker:process.env.CREATE_AS})); console.log('https://github.com/team/agent-office/issues/43'); }
else if (args[0] === 'issue' && args[1] === 'view') console.log(JSON.stringify({number:42,state:'OPEN',body:title,comments:[]}));
else if (args[0] === 'issue' && args.includes('open')) console.log(JSON.stringify([{number:42,title,state:'OPEN',url:'https://github.com/team/agent-office/issues/42'}]));
else console.log('[]');
`);
  chmodSync(cli, 0o755);
  const previous = process.env.PATH;
  process.env.PATH = `${root}${path.delimiter}${previous}`;
  t.after(() => { process.env.PATH = previous; });
  const board = new MaintenanceBoard(() => {}, source);
  await board.refresh();
  assert.equal(board.state.repo, 'team/agent-office');
  assert.equal(board.state.items[0].title, 'Fix the maintenance closet');
  assert.equal((await board.issue(42, 'reviewer')).body, 'Fix the maintenance closet');
  assert.match(await board.request(42), /Fix the maintenance closet/);
  assert.match(await board.request(42), /https:\/\/github.com\/team\/agent-office\/issues\/42/);
  assert.equal(await board.claim(42), undefined);
  assert.equal((await board.create('Improve Maintenance', 'Keep ideas while it works', { env: { ...process.env, CREATE_AS: 'requester' } } as any)).number, 43);
  const created = JSON.parse(readFileSync(path.join(source, 'created.json'), 'utf8'));
  assert.equal(created.marker, 'requester');
  assert.ok(created.args.includes('team/agent-office'));
  assert.ok(created.args.includes('Keep ideas while it works'));
  await assert.rejects(board.create('', ''), /title/);
  await assert.rejects(board.issue(-1), /Bad issue number/);
  board.stop();
});

test('maintenance board refuses to fall back to upstream without a GitHub origin', async (t) => {
  const source = mkdtempSync(path.join(tmpdir(), 'ao-maintenance-no-origin-'));
  t.after(() => rmSync(source, { recursive: true, force: true }));
  execFileSync('git', ['init', source]);
  execFileSync('git', ['remote', 'add', 'upstream', 'https://github.com/upstream/agent-office.git'], { cwd: source });
  const board = new MaintenanceBoard(() => {}, source);
  await board.refresh();
  assert.match(board.state.error!, /GitHub origin remote/);
  await assert.rejects(board.request(42), /GitHub origin remote/);
});
