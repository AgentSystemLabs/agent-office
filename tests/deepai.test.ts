import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import path from 'node:path';
import { deepaiAgentDir, deepaiApp, deepaiFreeModel, deepaiLauncherText, deepaiTransport, readDeepaiModels, writeDeepaiLauncher } from '../src/server/deepai.js';
import { piExtensionSource, writePiExtension } from '../src/server/pi.js';
import { providerAdapter } from '../src/server/providers/index.js';
import { MODEL_LISTERS } from '../src/server/models.js';

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'deepai-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** An app folder that looks like an installed macOS bundle, enough for the launcher to find it. */
function fakeApp(root: string) {
  const app = path.join(root, 'DeepAI Code.app');
  const helper = path.join(app, 'Contents', 'Frameworks', 'DeepAI Code Helper.app', 'Contents', 'MacOS', 'DeepAI Code Helper');
  const cli = path.join(app, 'Contents', 'Resources', 'app.asar', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js');
  for (const file of [helper, cli]) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '');
  }
  return { app, helper, cli };
}

test('the app folder is found, and the launcher runs its own binary on the bundled agent', (t) => {
  const root = fixture(t);
  const { app, helper, cli } = fakeApp(root);
  const env = { DEEPAI_APP: app };
  assert.deepEqual(deepaiApp(env), { helper, cli });
  // Nothing installed is nothing to launch, not a guess.
  assert.equal(deepaiApp({ DEEPAI_APP: path.join(root, 'nowhere.app') }), undefined);

  const agentDir = path.join(root, 'agent');
  const text = deepaiLauncherText({ helper, cli }, agentDir);
  // The app's binary is the runtime, its agent the program, and the app's folder the sign-in.
  assert.match(text, /^#!\/bin\/sh\n/);
  assert.ok(text.includes(`ELECTRON_RUN_AS_NODE=1 exec '${helper}' '${cli}' "$@"`));
  assert.ok(text.includes(`: "\${PI_CODING_AGENT_DIR:=${agentDir}}"`));
  // A folder with a quote or a $ in it stays one argument.
  const odd = deepaiLauncherText({ helper: "/tmp/it's/a$b", cli: '/tmp/c' }, "/tmp/it's");
  assert.ok(odd.includes(`exec '/tmp/it'\\''s/a$b'`), odd);
});

test('the office writes the launcher into the floor bin, where its workers find it', (t) => {
  const root = fixture(t);
  const { app } = fakeApp(root);
  const file = writeDeepaiLauncher(root, { DEEPAI_APP: app, DEEPAI_AGENT_DIR: path.join(root, 'agent') });
  assert.equal(file, path.join(root, 'bin', 'deepai-agent'));
  assert.ok(statSync(file!).mode & 0o100, 'executable');
  assert.match(readFileSync(file!, 'utf8'), /ELECTRON_RUN_AS_NODE=1/);
  // Without the app there's nothing to point it at.
  assert.equal(writeDeepaiLauncher(path.join(root, 'b'), { DEEPAI_APP: path.join(root, 'nowhere.app') }), undefined);
});

test('the agent folder follows DeepAI Code, unless the machine says otherwise', () => {
  assert.equal(deepaiAgentDir({}), path.join(homedir(), '.deepai-code', 'userdata', 'deepai', 'pi', 'deepai'));
  assert.equal(deepaiAgentDir({ PI_CODING_AGENT_DIR: '/opt/deepai' }), '/opt/deepai');
  // The office's own override gives way to Pi's, which is what the agent itself honours.
  assert.equal(deepaiAgentDir({ DEEPAI_AGENT_DIR: '/opt/other', PI_CODING_AGENT_DIR: '/opt/deepai' }), '/opt/deepai');
});

test('its models come from the app own list, by id, with their names and what they spend', (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, 'models.json'), JSON.stringify({
    providers: {
      deepai: {
        models: [
          { id: 'glm-5.3-flash', name: 'GLM 5.3 Flash', premier: false, theosPerRequest: '0' },
          { id: 'claude-opus-5-5', name: 'claude-opus-5-5', premier: true, theosPerRequest: '15' },
          { id: 'mimo-2.6-pro', name: 'MiMo 2.6 Pro', premier: false, theosPerRequest: 0 },
          { id: 'solar-mini-4' },
        ],
      },
      anthropic: { models: [{ id: 'claude-sonnet-5-5' }] },
      broken: { models: 'nope' },
    },
  }));
  assert.deepEqual(readDeepaiModels(root), [
    // Its own provider needs no prefix; another provider's keeps the one Pi resolves.
    { id: 'glm-5.3-flash', name: 'GLM 5.3 Flash · free', free: true },
    { id: 'claude-opus-5-5', name: 'claude-opus-5-5 · 15 Theos/call', free: false },
    { id: 'mimo-2.6-pro', name: 'MiMo 2.6 Pro · free', free: true },
    // No name of its own: the id stands in, with the same price tag.
    { id: 'solar-mini-4', name: 'solar-mini-4 · free', free: true },
    { id: 'anthropic/claude-sonnet-5-5', name: 'anthropic/claude-sonnet-5-5 · free', free: true },
  ]);
  // Left alone, a desk starts on one that spends nothing, never on a premier one.
  assert.equal(deepaiFreeModel(root), 'glm-5.3-flash');
  // A list that isn't there, or isn't the app's, is no suggestions rather than a broken picker.
  assert.deepEqual(readDeepaiModels(path.join(root, 'missing')), []);
  writeFileSync(path.join(root, 'models.json'), 'not json');
  assert.deepEqual(readDeepaiModels(root), []);
  assert.ok(MODEL_LISTERS.deepai);
});

test('every run gets its own session and the event route of its own provider', (t) => {
  const root = fixture(t);
  // The launcher written for DeepAI reports on its own route: the office handles each separately.
  const pi = writePiExtension(root, 'pi');
  const deepai = writePiExtension(root, 'deepai');
  assert.notEqual(pi, deepai);
  assert.match(readFileSync(pi, 'utf8'), /new URL\('\/hooks\/pi'/);
  assert.match(readFileSync(deepai, 'utf8'), /new URL\('\/hooks\/deepai'/);
  // Same events, same statuses: only the route differs.
  assert.equal(piExtensionSource('deepai'), piExtensionSource('pi').replace("'/hooks/pi'", "'/hooks/deepai'"));
  assert.equal(providerAdapter('deepai')?.id, 'deepai');
  assert.equal(providerAdapter('deepai')?.hook?.strictJson, true);
});

test('a model key the app fills in for its own runs is not one a worker has', (t) => {
  const root = fixture(t);
  const write = (apiKey: string) =>
    writeFileSync(path.join(root, 'models.json'), JSON.stringify({ providers: { deepai: { apiKey, models: [{ id: 'glm-5.3-flash' }] } } }));
  // A key in the file is a key a worker can use.
  write('plain-key');
  assert.deepEqual(deepaiTransport(root, {}), { ready: true });
  // A variable is a capability for one of the app's own runs: none here, and none when it's set.
  write('$T3_DEEPAI_TOKEN');
  assert.deepEqual(deepaiTransport(root, {}), { variable: 'T3_DEEPAI_TOKEN', ready: false });
  assert.deepEqual(deepaiTransport(root, { T3_DEEPAI_TOKEN: 'x' }), { variable: 'T3_DEEPAI_TOKEN', ready: true });
  // No key at all, or no file: nothing to start with.
  write('');
  assert.deepEqual(deepaiTransport(root, {}), { ready: false });
  assert.deepEqual(deepaiTransport(path.join(root, 'missing'), {}), { ready: false });
});
