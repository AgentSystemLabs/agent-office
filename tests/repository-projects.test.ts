import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { RepositoryProjects } from '../src/server/repository-projects.js';

const execFileP = promisify(execFile);

async function git(args: string[], cwd: string) {
  return execFileP('git', args, { cwd, encoding: 'utf8' });
}

async function repository(root: string, name: string, remote: string) {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  await git(['init', '-q'], dir);
  await git(['config', 'user.email', 'tests@example.invalid'], dir);
  await git(['config', 'user.name', 'Repository tests'], dir);
  writeFileSync(path.join(dir, 'README.md'), `${name}\n`);
  await git(['add', 'README.md'], dir);
  await git(['commit', '-qm', 'initial'], dir);
  await git(['remote', 'add', 'origin', remote], dir);
  return dir;
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-repository-projects-'));
  const office = path.join(root, 'office');
  const data = path.join(office, '.agent-office');
  mkdirSync(office, { recursive: true });
  return { root, office, data };
}

test('bind verifies the repository root and GitHub remote, then persists an atomic 0600 map', async () => {
  const f = fixture();
  try {
    const checkout = await repository(f.root, 'widget', 'git@github.com:acme/widget.git');
    const office = new RepositoryProjects(f.office, f.data);
    const project = await office.bind('acme/widget', checkout);
    assert.deepEqual(project, { repository: 'acme/widget', dir: checkout });
    assert.deepEqual(JSON.parse(readFileSync(path.join(f.data, 'repository-projects.json'), 'utf8')), { 'acme/widget': checkout });
    assert.equal(statSync(path.join(f.data, 'repository-projects.json')).mode & 0o777, 0o600);
    assert.match(readFileSync(path.join(f.data, 'repositories', 'AGENTS.md'), 'utf8'), /acme\/widget/);
    assert.match(office.context(project), new RegExp(`${checkout.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

    await assert.rejects(office.bind('acme/widget', path.join(checkout, 'nested')), /repository root|nested/i);
    await assert.rejects(office.bind('acme/other', checkout), /remote does not match/i);
    await assert.rejects(office.bind('acme/widget', `${checkout}\0bad`), /invalid checkout directory/i);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('does not overwrite a user AGENTS.md and rejects spoofed GitHub hosts', async () => {
  const f = fixture();
  try {
    const checkout = await repository(f.root, 'widget', 'https://github.com.evil/acme/widget.git');
    mkdirSync(path.join(f.data, 'repositories'), { recursive: true });
    const userFile = path.join(f.data, 'repositories', 'AGENTS.md');
    writeFileSync(userFile, 'user instructions\n');
    const office = new RepositoryProjects(f.office, f.data);
    await assert.rejects(office.bind('acme/widget', checkout), /remote does not match/i);
    assert.equal(readFileSync(userFile, 'utf8'), 'user instructions\n');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('bounded discovery persists and reloads a checkout, while a stale known mapping does not fall back', async () => {
  const f = fixture();
  try {
    const checkout = await repository(f.root, 'widget', 'https://github.com/acme/widget.git');
    const secondCheckout = await repository(f.root, 'gadget', 'https://github.com/acme/gadget.git');
    const first = new RepositoryProjects(f.office, f.data);
    assert.deepEqual(await first.resolve('acme/widget'), { repository: 'acme/widget', dir: checkout });
    assert.deepEqual(await first.resolve('acme/gadget'), { repository: 'acme/gadget', dir: secondCheckout });
    const second = new RepositoryProjects(f.office, f.data);
    assert.deepEqual(await second.resolve('acme/widget'), { repository: 'acme/widget', dir: checkout });
    const instructions = readFileSync(path.join(f.data, 'repositories', 'AGENTS.md'), 'utf8');
    assert.match(instructions, /acme\/widget/);
    assert.match(instructions, /acme\/gadget/);

    const stale = path.join(f.root, 'stale');
    const raw = JSON.parse(readFileSync(path.join(f.data, 'repository-projects.json'), 'utf8')) as Record<string, string>;
    raw['acme/widget'] = stale;
    writeFileSync(path.join(f.data, 'repository-projects.json'), `${JSON.stringify(raw)}\n`);
    assert.equal(await new RepositoryProjects(f.office, f.data).resolve('acme/widget'), undefined);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('clone refuses an existing destination before invoking git', async () => {
  const f = fixture();
  try {
    const destination = path.join(f.root, 'widget');
    mkdirSync(destination);
    const office = new RepositoryProjects(f.office, f.data);
    await assert.rejects(office.clone('acme/widget', destination), /destination already exists/i);
    await assert.rejects(office.clone('acme/widget', `${destination}\0bad`), /invalid clone destination/i);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('corrupt configuration fails closed without overwriting it', async () => {
  const f = fixture();
  try {
    mkdirSync(f.data, { recursive: true });
    const config = path.join(f.data, 'repository-projects.json');
    writeFileSync(config, '{broken\n');
    const office = new RepositoryProjects(f.office, f.data);
    await assert.rejects(office.resolve('acme/widget'), /Could not load repository project configuration/i);
    await assert.rejects(office.bind('acme/widget', f.office), /Could not load repository project configuration/i);
    assert.equal(readFileSync(config, 'utf8'), '{broken\n');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
