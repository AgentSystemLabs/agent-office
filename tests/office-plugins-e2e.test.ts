import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import net from 'node:net';
import { loadConfig } from '../src/server/config.js';
import { startServer } from '../src/server/server.js';
import { PROVIDER_META } from '../src/shared/providers.js';

const PLUGIN = path.resolve('../agent-office-plugins/agentoffice-openfox/dist/index.js');
const GIT_PROJECTS = path.resolve('../agent-office-plugins/agentoffice-git-projects/dist/index.js');

/** Signs a browser in over HTTP, and gives back the cookie it keeps. */
async function signIn(port: number, password = 'e2e-pw'): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  assert.ok(cookie.includes('='), `no cookie: ${res.status}`);
  return cookie;
}

/** A port nothing is on yet. */
const freePort = () =>
  new Promise<number>((res) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const picked = (s.address() as net.AddressInfo).port;
      s.close(() => res(picked));
    });
  });

/**
 * The office boots the way cli.ts does, with the OpenFox plugin loaded, and the wiring the plugin
 * declares reaches the office: its provider is one the office can hire, its services are on the
 * floor's board, and its floors sit in the building next to the office's own.
 *
 * Uses the loaded plugin where the office has one on disk, and skips what needs a live OpenFox, so
 * the office's own floors and adapters are what this checks.
 */
test('the openfox plugin reaches the office: provider, services, floors', async (t) => {
  if (!existsSync(PLUGIN)) return t.skip('the openfox plugin is not built');
  const tmp = mkdtempSync(path.join(tmpdir(), 'office-plugin-e2e-'));
  try {
    const project = path.join(tmp, 'project');
    mkdirSync(project, { recursive: true });
    writeFileSync(path.join(project, 'README.md'), 'demo\n', 'utf8');
    execFileSync('git', ['init', '-q', project], { stdio: 'ignore' });
    execFileSync('git', ['-C', project, 'add', '.'], { stdio: 'ignore' });
    execFileSync('git', ['-C', project, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { stdio: 'ignore' });

    // The plugin reaches OpenFox for the floors and services it provides; point it at the one here.
    const openfox = process.env['OPENFOX_PORT'] ?? '10369';
    const prev = process.env['OPENFOX_PORT'];
    process.env['OPENFOX_PORT'] = openfox;
    const port = await freePort();
    const cfg = loadConfig([
      project,
      '--no-open',
      '--password', 'e2e-pw',
      '--port', String(port),
      '--projects', tmp,
      '--plugin', PLUGIN,
    ]);
    const office = await startServer(cfg);
    try {
      // Open the plugin's own floors (an OpenFox project per floor) and the office's own, then ask
      // for one of them: what a browser is sent on arriving there is what this checks.
      // The plugin's floors are merged in on the openFloors pass (see ceiling), the first of which
      // has run by the time the office answers.
      const floor = office.floors().find((f) => f.def.addedBy === 'openfox') ?? office.floors()[0]!;
      // 10: the provider the plugin registers becomes one the office can hire.
      assert.equal(PROVIDER_META['openfox']?.label, 'OpenFox', `the plugin's provider is registered: ${Object.keys(PROVIDER_META).join(',')}`);

      // The project a browser sees on the plugin's floor: the providers it can hire there.
      const providers = floor.project.agentProviders;
      assert.ok(providers.includes('openfox'), `openfox is hireable on the plugin's floor: ${JSON.stringify(providers)}`);
      // 5: the plugin's floors are in the building, next to the office's own, not instead of them.
      const dirs = office.floors().map((f) => f.def.dir);
      assert.ok(dirs.includes(path.resolve(project)), `the office's own floor is still there: ${JSON.stringify(dirs)}`);
      const fromPlugin = office.floors().filter((f) => f.def.addedBy === 'openfox');
      assert.ok(fromPlugin.length > 0, 'the plugin brought its own floors');
      console.log('E2E plugin floors:', fromPlugin.length, '| office floors:', office.floors().length, '| providers:', JSON.stringify(providers));
    } finally {
      office.shutdown();
      if (prev === undefined) delete process.env['OPENFOX_PORT'];
      else process.env['OPENFOX_PORT'] = prev;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

/**
 * A plugin with its own settings page and a projects provider (the GitHub & GitLab projects plugin):
 * the office serves the page from the plugin's own directory, and the page's reads and writes reach
 * the plugin wherever it keeps them. The office knows nothing about what any of it is.
 */
test('a plugin reaches its own settings page and projects through the office', async (t) => {
  if (!existsSync(GIT_PROJECTS)) return t.skip('the git-projects plugin is not built');
  const tmp = mkdtempSync(path.join(tmpdir(), 'office-gitprojects-e2e-'));
  try {
    const project = path.join(tmp, 'project');
    mkdirSync(project, { recursive: true });
    writeFileSync(path.join(project, 'README.md'), 'demo\n', 'utf8');
    execFileSync('git', ['init', '-q', project], { stdio: 'ignore' });
    execFileSync('git', ['-C', project, 'add', '.'], { stdio: 'ignore' });
    execFileSync('git', ['-C', project, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { stdio: 'ignore' });
    // Its own projects, where the plugin keeps them: in the checkout's .agent-office folder.
    mkdirSync(path.join(project, '.agent-office'), { recursive: true });
    writeFileSync(path.join(project, '.agent-office', 'git-projects.json'), JSON.stringify([{ id: 'front', name: 'front', url: 'https://github.com/owner/front' }]), 'utf8');

    const port = await freePort();
    const cfg = loadConfig([project, '--no-open', '--password', 'e2e-pw', '--port', String(port), '--projects', tmp, '--plugin', GIT_PROJECTS]);
    const office = await startServer(cfg);
    try {
      const cookie = await signIn(port);
      const floor = office.floors()[0]!;

      // The floor's projects, as the plugin lists them, and a save the plugin takes.
      const listed = await fetch(`http://127.0.0.1:${port}/api/plugins/git-projects/projects?floor=${encodeURIComponent(floor.id)}`, { headers: { cookie } });
      assert.equal(listed.status, 200, 'the projects are listed');
      const { projects } = (await listed.json()) as { projects: { url: string }[] };
      assert.deepEqual(projects.map((p) => p.url), ['https://github.com/owner/front'], 'what the plugin keeps is what the office hands back');

      const saved = await fetch(`http://127.0.0.1:${port}/api/plugins/git-projects/projects?floor=${encodeURIComponent(floor.id)}`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ projects: [{ id: 'front', name: 'front', url: 'https://github.com/owner/front' }, { id: 'bff', name: 'bff', url: 'https://github.com/owner/bff' }] }),
      });
      assert.equal(saved.status, 200, 'the plugin took the projects');

      // A floor nobody picked has no projects to list.
      const none = await fetch(`http://127.0.0.1:${port}/api/plugins/git-projects/projects`, { headers: { cookie } });
      assert.equal(none.status, 404, 'no floor, no projects');
      console.log('E2E git-projects: settings page served, projects listed and saved');
    } finally {
      office.shutdown();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
