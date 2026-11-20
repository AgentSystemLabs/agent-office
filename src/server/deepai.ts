// DeepAI Code: the app is a Pi coding agent with its own sign-in, its own model list and the local
// model server those models are reached through. There is no separate CLI to put on PATH — its few
// commands (start, serve, pair) drive the app, not an agent in a terminal — so a worker runs the Pi
// agent bundled inside the app, through a small launcher the office writes per floor. That launcher
// starts the app's own Electron binary as Node (ELECTRON_RUN_AS_NODE) on the bundled agent, and
// points it at the app's agent folder, where models.json names the models and holds the key for the
// local model server. The extension is Pi's (see ./pi.ts), reporting on /hooks/deepai.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { isValidDeepaiModel, type ModelOption } from '../shared/providers.js';
import { shq } from './workers/process.js';

/** The launcher's name: what PROVIDER_META.deepai runs as, and what the office writes. */
export const DEEPAI_AGENT = 'deepai-agent';

/** Where the app keeps the agent: its models, its sign-in, its settings. */
export function deepaiAgentDir(env: NodeJS.ProcessEnv = process.env): string {
  const given = env.PI_CODING_AGENT_DIR?.trim();
  if (given) return path.resolve(given);
  const own = env.DEEPAI_AGENT_DIR?.trim();
  if (own) return path.resolve(own);
  return path.join(homedir(), '.deepai-code', 'userdata', 'deepai', 'pi', 'deepai');
}

/** The two files needed to run DeepAI Code's agent: the app's binary, and the agent it bundles. */
export interface DeepaiApp {
  /** The app's own executable, run as Node (electron's ELECTRON_RUN_AS_NODE). */
  helper: string;
  /** The Pi agent inside the app bundle. */
  cli: string;
}

/** The app's resources folder, for a given app folder or one of the places it installs to. */
function appDirs(env: NodeJS.ProcessEnv): string[] {
  const given = env.DEEPAI_APP?.trim();
  if (given) {
    // An .app bundle, a folder holding one, or the executable inside it. Said where it is, it's
    // looked for there and nowhere else: a stale setting shouldn't quietly use another install.
    const at = path.resolve(given);
    const bundle = /^(.*\.app)(?:\/|$)/.exec(at)?.[1];
    return [bundle ?? at, path.join(at, 'DeepAI Code.app')];
  }
  if (process.platform === 'darwin') return ['/Applications/DeepAI Code.app', path.join(homedir(), 'Applications', 'DeepAI Code.app')];
  return [];
}

/** The app's binary and bundled agent, when it's installed here; undefined when it isn't. */
export function deepaiApp(env: NodeJS.ProcessEnv = process.env): DeepaiApp | undefined {
  const agent = path.join('node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js');
  for (const dir of appDirs(env)) {
    // The agent lives inside the app's archive, which only the app's own binary can read: its path
    // can't be checked from here, only the archive holding it.
    const macHelper = path.join(dir, 'Contents', 'Frameworks', 'DeepAI Code Helper.app', 'Contents', 'MacOS', 'DeepAI Code Helper');
    const macAsar = path.join(dir, 'Contents', 'Resources', 'app.asar');
    if (existsSync(macHelper) && existsSync(macAsar)) return { helper: macHelper, cli: path.join(macAsar, agent) };
    // An unpacked app folder (Linux, or a Windows install given in DEEPAI_APP).
    const helper = path.join(dir, path.basename(dir));
    const asar = path.join(dir, 'resources', 'app.asar');
    if (existsSync(helper) && existsSync(asar)) return { helper, cli: path.join(asar, agent) };
  }
  return undefined;
}

/** The launcher's shell script: the app's binary as Node, on its bundled agent, with the app's folder. */
export function deepaiLauncherText(app: DeepaiApp, agentDir: string): string {
  return [
    '#!/bin/sh',
    "# DeepAI Code's agent: the Pi agent the app ships, on the app's own sign-in and model list.",
    '# Written by the office for its workers (see server/deepai.ts).',
    `: "\${PI_CODING_AGENT_DIR:=${agentDir.replace(/["$`\\]/g, '\\$&')}}"`,
    'export PI_CODING_AGENT_DIR',
    `ELECTRON_RUN_AS_NODE=1 exec ${shq(app.helper)} ${shq(app.cli)} "$@"`,
    '',
  ].join('\n');
}

/** Writes the launcher into the floor's bin/, where its workers find it, and returns its path. */
export function writeDeepaiLauncher(dataDir: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  // The launcher is a shell script, and the office writes shell commands on POSIX only.
  if (process.platform === 'win32') return undefined;
  const app = deepaiApp(env);
  if (!app) return undefined;
  const dir = path.join(dataDir, 'bin');
  const file = path.join(dir, DEEPAI_AGENT);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, deepaiLauncherText(app, deepaiAgentDir(env)), { mode: 0o700 });
  chmodSync(file, 0o700);
  return file;
}

/**
 * How the app lets a process reach its models: a plain key in models.json, or the name of a variable
 * only the app itself fills (its managed Pi runs get a capability for the run, and nobody else).
 */
export interface DeepaiTransport {
  /** The variable models.json asks for, when it asks for one ("T3_DEEPAI_TOKEN"). */
  variable?: string;
  /** Whether a worker started here would have a key at all. */
  ready: boolean;
}

export function deepaiTransport(agentDir: string = deepaiAgentDir(), env: NodeJS.ProcessEnv = process.env): DeepaiTransport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path.join(agentDir, 'models.json'), 'utf8'));
  } catch {
    return { ready: false };
  }
  const providers = (parsed as { providers?: unknown })?.providers;
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return { ready: false };
  const key = (providers as Record<string, { apiKey?: unknown }>).deepai?.apiKey;
  if (typeof key !== 'string' || !key.trim()) return { ready: false };
  const variable = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(key.trim())?.[1];
  if (!variable) return { ready: true };
  // A placeholder: the app hands that capability to the Pi it starts, and to nobody else.
  return { variable, ready: !!env[variable]?.trim() };
}

/**
 * The free model a desk starts on when nobody picked one: DeepAI charges Theos per request on its
 * premier models, and a worker left on the app's own default can spend them without anyone asking
 * (fifteen Theos for one Opus reply, on this machine). A free one spends none, whatever runs.
 */
export function deepaiFreeModel(agentDir: string = deepaiAgentDir()): string | undefined {
  return readDeepaiModels(agentDir).find((model) => model.free)?.id;
}

/**
 * What a model spends per request: zero for the free ones, its Theos for a premier one (the balance
 * that refuses a worker with `theos_insufficient`).
 */
function deepaiTheos(model: unknown): number {
  const raw = (model as { theosPerRequest?: unknown })?.theosPerRequest;
  const theos = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : 0;
  return Number.isFinite(theos) && theos > 0 ? theos : 0;
}

/**
 * The models DeepAI Code offers, from its own models.json: each provider's list, of which the office
 * keeps the id and its name, tagged with what it spends — `free`, or the Theos a premier one costs.
 * A model of the app's own provider is offered by its id alone; another provider's keeps its
 * `provider/` prefix, as Pi resolves it.
 */
export function readDeepaiModels(agentDir: string = deepaiAgentDir()): ModelOption[] {
  const file = path.join(agentDir, 'models.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  const providers = (parsed as { providers?: unknown })?.providers;
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return [];
  const models: ModelOption[] = [];
  for (const [provider, entry] of Object.entries(providers as Record<string, unknown>)) {
    const listed = (entry as { models?: unknown })?.models;
    if (!Array.isArray(listed)) continue;
    for (const model of listed) {
      const raw = (model as { id?: unknown })?.id;
      if (typeof raw !== 'string') continue;
      const id = provider === 'deepai' ? raw : `${provider}/${raw}`;
      if (!isValidDeepaiModel(id)) continue;
      const shown = (model as { name?: unknown })?.name;
      const label = typeof shown === 'string' && shown.trim() && shown !== raw ? shown.trim() : id;
      const theos = deepaiTheos(model);
      // Per call, not per task: an agent turn that runs ten tools is ten calls.
      models.push({ id, name: `${label} · ${theos ? `${theos} Theos/call` : 'free'}`, free: theos === 0 });
    }
  }
  return models;
}
