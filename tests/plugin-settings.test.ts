import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PluginManager } from '../src/server/plugins/manager.js';

/**
 * A plugin can bring its own settings page: any file it ships under its own directory, served by
 * the office at /plugins/<id>/<file>. The office knows nothing about what it contains, so any
 * plugin can have its own settings UI, and one without is simply absent from ⚙️ Settings → Plugins.
 */
test('a plugin ships a settings page the office serves from its own directory', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugin-settings-'));
  const dir = path.join(tmp, 'plugins', 'demo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'settings.html'), '<h1>demo settings</h1>', 'utf8');
  writeFileSync(
    path.join(dir, 'index.js'),
    'export function createPlugin(){return {manifest:{id:"demo",name:"Demo",description:"d",capabilities:[],enabled:true,settingsPage:"settings.html"}}};',
    'utf8',
  );
  process.env['AGENT_OFFICE_PLUGIN'] = path.join(dir, 'index.js');
  try {
    const mgr = new PluginManager(tmp);
    await mgr.init({} as never);
    // The manifest field travels through to the state the browsers get, under the plugin's own id.
    const found = mgr.getState().plugins.find((p) => p.id === 'demo');
    assert.ok(found, `demo not in ${JSON.stringify(mgr.getState().plugins.map((p) => p.id))}`);
    assert.equal(found.status, 'active');
    assert.equal(found.settingsPage, 'settings.html');
    // And the office can say where that file is, for serving it to the browser.
    assert.equal(mgr.settingsPagePath('demo'), path.join(dir, 'settings.html'));
    await mgr.shutdown();
  } finally {
    delete process.env['AGENT_OFFICE_PLUGIN'];
  }
});

test('a plugin with no settings page has no path, and the core says nothing about it', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugin-nosettings-'));
  process.env['AGENT_OFFICE_PLUGIN'] = path.join(tmp, 'nothing.js');
  try {
    const mgr = new PluginManager(tmp);
    await mgr.init({} as never);
    assert.equal(mgr.settingsPagePath('demo'), undefined);
    await mgr.shutdown();
  } finally {
    delete process.env['AGENT_OFFICE_PLUGIN'];
  }
});

test("a plugin's settings page sits at the top of its directory, beside its package.json", async () => {
  // A plugin's files usually sit beside its built entry, but a build that cleans its output folder
  // (tsup with clean: true) keeps only the bundle, so the page is often at the top of the directory.
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugin-settings-root-'));
  const dir = path.join(tmp, '.agent-office', 'plugins', 'demo');
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(dir, 'dist'), { recursive: true });
  writeFileSync(path.join(dir, 'settings.html'), '<h1>at the top</h1>', 'utf8');
  writeFileSync(path.join(dir, 'dist', 'index.js'), 'export function createPlugin(){return {manifest:{id:"demo",name:"Demo",description:"d",capabilities:[],enabled:true,settingsPage:"settings.html"}}};', 'utf8');
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', main: 'dist/index.js' }), 'utf8');
  process.env['AGENT_OFFICE_PLUGIN'] = path.join(dir, 'dist', 'index.js');
  try {
    const mgr = new PluginManager(tmp);
    await mgr.init({} as never);
    assert.equal(mgr.settingsPagePath('demo'), path.join(dir, 'settings.html'), 'found at the top of the directory');
    await mgr.shutdown();
  } finally {
    delete process.env['AGENT_OFFICE_PLUGIN'];
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('a settings page asking for a file outside its plugin is refused', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugin-settings-esc-'));
  const dir = path.join(tmp, 'plugins', 'demo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'index.js'), 'export function createPlugin(){return {manifest:{id:"demo",name:"Demo",description:"d",capabilities:[],enabled:true}}}');
  // A file outside the plugin's directory, one level up.
  writeFileSync(path.join(tmp, 'secret.txt'), 'not yours', 'utf8');
  try {
    const mgr = new PluginManager(tmp);
    assert.equal(mgr.settingsPagePathOf('demo', '../secret.txt'), undefined);
    assert.equal(mgr.settingsPagePathOf('demo', '/etc/passwd'), undefined);
    assert.equal(mgr.settingsPagePathOf('demo', ''), undefined);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('a plugin loaded from a file appears under its own id, once', async () => {
  // The office files a plugin under the name of the file it was pointed at, but a plugin names itself
  // in its manifest. Settings shows the name it gives itself, not the file's.
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugin-own-id-'));
  const dir = path.join(tmp, 'plugins', 'git-projects');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'settings.html'), '<h1>mine</h1>', 'utf8');
  writeFileSync(path.join(dir, 'index.js'), 'export function createPlugin(){return {manifest:{id:"git-projects",name:"GitHub & GitLab Projects",description:"d",capabilities:["issues","pulls"],enabled:true,settingsPage:"settings.html"}}};', 'utf8');
  process.env['AGENT_OFFICE_PLUGIN'] = path.join(dir, 'index.js');
  try {
    const mgr = new PluginManager(tmp);
    await mgr.init({} as never);
    const state = mgr.getState();
    const ids = state.plugins.map((p) => p.id);
    assert.ok(ids.includes('git-projects'), `its own id is there: ${JSON.stringify(ids)}`);
    assert.equal(ids.filter((id) => id === 'git-projects').length, 1, 'exactly once');
    // The file name is not a card of its own: nothing is served for it either.
    assert.equal(ids.includes('index'), false, `the file name is not a plugin of its own: ${JSON.stringify(ids)}`);
    assert.equal(mgr.settingsPagePathOf('index', 'settings.html'), undefined);
    // The card that is there has the plugin's own settings page, wherever that one is on disk.
    const found = mgr.settingsPagePath('git-projects');
    assert.ok(found, 'the page is found');
    assert.match(found, /settings\.html$/);
    // And its card carries the page, the way the settings pane reads it.
    const card = state.plugins.find((p) => p.id === 'git-projects');
    assert.equal(card?.settingsPage, 'settings.html');
    await mgr.shutdown();
  } finally {
    delete process.env['AGENT_OFFICE_PLUGIN'];
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('a plugin whose file is named for itself keeps that card', async () => {
  // Nothing to give way: the file name and the manifest id are the same one.
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugin-same-id-'));
  const dir = path.join(tmp, 'plugins', 'demo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'demo.js'), 'export function createPlugin(){return {manifest:{id:"demo",name:"Demo",description:"d",capabilities:[],enabled:true}}};', 'utf8');
  process.env['AGENT_OFFICE_PLUGIN'] = path.join(dir, 'demo.js');
  try {
    const mgr = new PluginManager(tmp);
    await mgr.init({} as never);
    const ids = mgr.getState().plugins.map((p) => p.id);
    assert.deepEqual(ids, ['demo']);
    await mgr.shutdown();
  } finally {
    delete process.env['AGENT_OFFICE_PLUGIN'];
    rmSync(tmp, { recursive: true, force: true });
  }
});
