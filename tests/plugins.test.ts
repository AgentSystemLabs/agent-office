import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PluginManager } from '../src/server/plugins/manager.js';
import { PluginRegistry } from '../src/server/plugins/registry.js';

test('PluginRegistry registers and lists plugins', () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'registry-test-'));
  try {
    const reg = new PluginRegistry(tmpDir);
    reg.register({ id: 'test-plugin', name: 'Test Plugin', version: '1.0.0', description: 'A mock plugin', capabilities: ['floors', 'queue'] });
    const list = reg.list();
    assert.ok(list.length > 0);
    const p = reg.get('test-plugin');
    assert.ok(p);
    assert.equal(p?.id, 'test-plugin');
    assert.deepEqual(p?.capabilities, ['floors', 'queue']);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('PluginManager dynamically loads an external plugin', async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'plugin-mgr-test-'));
  const mockPluginPath = path.join(tmpDir, 'mock-plugin.mjs');
  const mockPluginCode = `
export function createPlugin() {
  return {
    manifest: { id: 'mock-ext', name: 'Mock Extension', version: '1.0.0', description: 'Mock external plugin', capabilities: ['floors', 'services', 'issues', 'pulls'] },
    floorProvider: {
      listFloors() { return [{ id: 'f1', name: 'Floor 1', dir: '/tmp/f1', palette: 0, addedBy: 'test', addedAt: Date.now() }]; }
    },
    servicesProvider: {
      async listServices() { return [{ port: 3000, host: 'localhost', pid: 123, command: 'test', workerId: 'w1', cwd: '/tmp/f1', since: Date.now() }]; }
    },
    issuesAdapter: {
      async listIssues() { return [{ number: 1, title: 'Issue 1', state: 'OPEN', url: 'http://example.com/1', author: 'test', labels: [], assignees: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), body: '', comments: 0 }]; }
    },
    pullsAdapter: {
      async listPulls() { return [{ number: 10, title: 'PR 10', state: 'OPEN', isDraft: false, url: 'http://example.com/pr/10', author: 'test', labels: [], reviewDecision: '', headRefName: 'feature-branch', baseRefName: 'main', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), additions: 10, deletions: 2, checks: 'none', body: '', closes: [] }]; }
    }
  };
}
`;
  writeFileSync(mockPluginPath, mockPluginCode);
  process.env.AGENT_OFFICE_PLUGIN = mockPluginPath;
  try {
    const mgr = new PluginManager(tmpDir);
    await mgr.init({} as any);
    const state = mgr.getState();
    // The plugin names itself in its manifest, so that is the id the office knows it by — the name of
    // the file it was loaded from is not a second card in Settings.
    const plugin = state.plugins.find((p) => p.id === 'mock-ext');
    assert.ok(plugin, `mock-ext not found in ${JSON.stringify(state)}`);
    assert.equal(plugin?.status, 'active');
    assert.equal(state.plugins.some((p) => p.id === 'mock-plugin'), false, 'the file name is not a plugin of its own');
    const fp = mgr.getFloorProvider();
    assert.ok(fp);
    const floors = await fp.listFloors();
    assert.equal(floors.length, 1);
    assert.equal(floors[0]?.id, 'f1');
    const sp = mgr.getServicesProvider();
    assert.ok(sp);
    const services = await sp.listServices({} as any);
    assert.equal(services.length, 1);
    assert.equal(services[0]?.port, 3000);
    const ip = mgr.getIssuesAdapter();
    assert.ok(ip);
    const issues = await ip!.listIssues({} as any);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.number, 1);
    assert.equal(issues[0]?.title, 'Issue 1');
    const pp = mgr.getPullsAdapter();
    assert.ok(pp);
    const pulls = await pp!.listPulls({} as any);
    assert.equal(pulls.length, 1);
    assert.equal(pulls[0]?.number, 10);
    assert.equal(pulls[0]?.title, 'PR 10');
    await mgr.shutdown();
  } finally {
    delete process.env.AGENT_OFFICE_PLUGIN;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('PluginManager loads git-projects plugin bundle if present', async () => {
  const pluginBundlePath = path.resolve(process.cwd(), 'plugins', 'git-projects.js');
  if (!existsSync(pluginBundlePath)) return;
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'git-plugin-test-'));
  try {
    process.env.AGENT_OFFICE_PLUGIN = pluginBundlePath;
    const mgr = new PluginManager(tmpDir);
    await mgr.init({} as any);
    const state = mgr.getState();
    const plugin = state.plugins.find((p) => p.id === 'git-projects');
    assert.ok(plugin);
    assert.equal(plugin?.status, 'active');
    assert.ok(mgr.getIssuesAdapter());
    assert.ok(mgr.getPullsAdapter());
    await mgr.shutdown();
  } finally {
    delete process.env.AGENT_OFFICE_PLUGIN;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('PluginManager installs and uninstalls plugins', async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'install-test-'));
  try {
    const mgr = new PluginManager(tmpDir);
    const reg = (mgr as any).registry as PluginRegistry;
    reg.register({ id: 'test-install', name: 'Test Install', version: '1.0.0', description: 'Test install desc', capabilities: [] });
    const ok = await mgr.install('test-install');
    assert.equal(ok, true);
    const ok2 = await mgr.uninstall('test-install');
    assert.equal(ok2, true);

    // With active runtime context, installing nonexistent plugin fails gracefully
    mgr.ctx = {} as any;
    const failInstall = await mgr.install('test-install');
    assert.equal(failInstall, false);
    const manifest = reg.get('test-install');
    assert.equal(manifest?.status, 'error');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
