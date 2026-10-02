// The models a provider's own CLI lists, for the hire dialog: what each is called and which
// reasoning efforts it takes, where the CLI says. Each is asked without a shell, and only what
// looks like a model gets through.
import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AGENT_EFFORTS, isValidCodexModel, isValidCursorModel, isValidGrokModel, isValidOpenCodeModel, type AgentProvider, type ModelOption } from '../shared/providers.js';

/** A CLI that lists its models in a second or two takes ten times that on a busy machine. */
export const MODEL_COMMAND_TIMEOUT_MS = 30_000;
export const MODEL_COMMAND_MAX_BUFFER = 1024 * 1024;
/** A catalogue with every model's details in it (Codex's, OpenCode's --verbose) runs to several hundred KB. */
export const MODEL_DETAILS_MAX_BUFFER = 16 * 1024 * 1024;
export const MODEL_CACHE_TTL_MS = 60_000;
const NAME_MAX = 80;

export interface ModelCommandOptions {
  cwd: string;
  timeout: number;
  maxBuffer: number;
}

export type ModelCommandRunner = (
  file: string,
  args: string[],
  options: ModelCommandOptions,
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Runs a CLI with its output going to a file rather than a pipe. A CLI that exits with output still
 * in a pipe loses the end of it, and OpenCode does on a long list: the catalogue came back short, a
 * different length each time.
 */
const runModelCommand: ModelCommandRunner = async (file, args, options) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-models-'));
  const out = path.join(dir, 'stdout');
  const fd = openSync(out, 'w', 0o600);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(file, args, { cwd: options.cwd, timeout: options.timeout, stdio: ['ignore', fd, 'ignore'] });
      child.on('error', reject);
      child.on('close', (code, signal) => (code === 0 ? resolve() : reject(new Error(`ended with ${signal ?? code}`))));
    });
    if (statSync(out).size > options.maxBuffer) throw new Error('too much output');
    return { stdout: readFileSync(out, 'utf8'), stderr: '' };
  } finally {
    closeSync(fd);
    rmSync(dir, { recursive: true, force: true });
  }
};

const plain = (text: string) => text.replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '');

/** A model's name as its catalogue gives it, when it's one a window can show and says more than the id. */
function shownName(value: unknown, id: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  return name && name !== id && name.length <= NAME_MAX ? name : undefined;
}

/** The office's efforts among `levels` (a catalogue may know others: "none", "ultra"), in the office's order. */
function knownEfforts(levels: readonly unknown[]): ModelOption['efforts'] {
  return AGENT_EFFORTS.filter((e) => levels.includes(e));
}

/** Each model once, in the order the catalogue gave them. */
function unique(models: ModelOption[]): ModelOption[] {
  const seen = new Set<string>();
  return models.filter((m) => !seen.has(m.id) && !!seen.add(m.id));
}

/**
 * `opencode models --verbose`: each model's id on a line of its own, then its details as JSON, of
 * which the office takes its name and its variants (OpenCode's reasoning efforts).
 */
function openCodeDetails(stdout: string): ModelOption[] {
  const models: ModelOption[] = [];
  let id: string | undefined;
  let json: string[] = [];
  const close = () => {
    if (!id) return;
    let details: any;
    try {
      details = JSON.parse(json.join('\n'));
    } catch {
      details = undefined;
    }
    const variants = details?.variants && typeof details.variants === 'object' ? Object.keys(details.variants) : undefined;
    const name = shownName(details?.name, id);
    models.push({ id, ...(name ? { name } : {}), ...(variants ? { efforts: knownEfforts(variants) } : {}) });
  };
  for (const line of plain(stdout).split(/\r?\n/)) {
    // Its JSON is indented, but for the braces around it: anything else at the margin is the next id.
    if (/^[{}\s]/.test(line) || !line) {
      json.push(line);
      continue;
    }
    close();
    id = isValidOpenCodeModel(line.trim()) ? line.trim() : undefined;
    json = [];
  }
  close();
  return unique(models);
}

/** Run `opencode models` without a shell and return only safe, model-shaped lines: with their details, from an OpenCode that gives them. */
export async function fetchOpenCodeModels(command: string, cwd: string, runner: ModelCommandRunner = runModelCommand): Promise<ModelOption[]> {
  try {
    const detailed = await runner(command, ['models', '--verbose'], { cwd, timeout: MODEL_COMMAND_TIMEOUT_MS, maxBuffer: MODEL_DETAILS_MAX_BUFFER })
      .then((result) => openCodeDetails(result.stdout))
      .catch(() => []);
    if (detailed.length) return detailed;
    const result = await runner(command, ['models'], { cwd, timeout: MODEL_COMMAND_TIMEOUT_MS, maxBuffer: MODEL_COMMAND_MAX_BUFFER });
    return unique(plain(result.stdout).split(/\r?\n/).map((raw) => raw.trim().replace(/^[-*]\s+/, '')).filter(isValidOpenCodeModel).map((id) => ({ id })));
  } catch {
    throw new Error('OpenCode model catalogue unavailable');
  }
}

/** Run `grok models` without a shell and return only safe model ids. */
export async function fetchGrokModels(command: string, cwd: string, runner: ModelCommandRunner = runModelCommand): Promise<ModelOption[]> {
  try {
    const result = await runner(command, ['models'], { cwd, timeout: MODEL_COMMAND_TIMEOUT_MS, maxBuffer: MODEL_COMMAND_MAX_BUFFER });
    const ids = plain(result.stdout).split(/\r?\n/).map((raw) => raw.trim().replace(/^[-*]\s+/, '').replace(/\s*\(default\)\s*$/i, '').trim());
    return unique(ids.filter(isValidGrokModel).map((id) => ({ id })));
  } catch {
    throw new Error('Grok model catalogue unavailable');
  }
}

/**
 * Run `codex debug models` without a shell: Codex's catalogue as JSON, of which the office takes
 * the models its own picker lists, what each is called and the reasoning efforts it supports.
 */
export async function fetchCodexModels(command: string, cwd: string, runner: ModelCommandRunner = runModelCommand): Promise<ModelOption[]> {
  try {
    const result = await runner(command, ['debug', 'models'], { cwd, timeout: MODEL_COMMAND_TIMEOUT_MS, maxBuffer: MODEL_DETAILS_MAX_BUFFER });
    const listed: unknown = JSON.parse(result.stdout)?.models;
    if (!Array.isArray(listed)) throw new Error('no models');
    const models: ModelOption[] = [];
    for (const m of listed) {
      if (!m || typeof m !== 'object' || !isValidCodexModel(m.slug) || (m.visibility !== undefined && m.visibility !== 'list')) continue;
      const name = shownName(m.display_name, m.slug);
      const levels = Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels.map((l: any) => l?.effort) : undefined;
      models.push({ id: m.slug, ...(name ? { name } : {}), ...(levels ? { efforts: knownEfforts(levels) } : {}) });
    }
    return unique(models);
  } catch {
    throw new Error('Codex model catalogue unavailable');
  }
}

/**
 * Run `cursor-agent models` without a shell and return only safe model ids, each with its name. It
 * prints one model a line, `<id> - <name>`, with `(current)` or `(default)` after some, under a
 * heading and over a tip.
 */
export async function fetchCursorModels(command: string, cwd: string, runner: ModelCommandRunner = runModelCommand): Promise<ModelOption[]> {
  try {
    const result = await runner(command, ['models'], { cwd, timeout: MODEL_COMMAND_TIMEOUT_MS, maxBuffer: MODEL_COMMAND_MAX_BUFFER });
    const models: ModelOption[] = [];
    for (const raw of plain(result.stdout).split(/\r?\n/)) {
      const line = raw.trim();
      const id = line.split(/\s/, 1)[0];
      // The heading, the tip and "No models available" are sentences: a model's line is its id alone, or its id, " - " and its name.
      const listed = /^\S+(?: - (.*?))?(?: \((?:current|default)[^)]*\))?$/.exec(line);
      if (!listed || !isValidCursorModel(id)) continue;
      const name = shownName(listed[1], id);
      models.push({ id, ...(name ? { name } : {}) });
    }
    return unique(models);
  } catch {
    throw new Error('Cursor model catalogue unavailable');
  }
}

type ModelLister = (command: string, cwd: string, runner?: ModelCommandRunner) => Promise<ModelOption[]>;

/** The providers whose CLI lists its models (ProviderMeta.models.catalog), and how each is asked. */
export const MODEL_LISTERS: Partial<Record<AgentProvider, ModelLister>> = {
  opencode: fetchOpenCodeModels,
  codex: fetchCodexModels,
  grok: fetchGrokModels,
  cursor: fetchCursorModels,
};

export interface ModelCatalogue {
  get(): Promise<ModelOption[]>;
}

/**
 * One provider's models: asked for once however many ask at the same time, and kept. A list older
 * than a minute is still what the next asker gets, at once, while the CLI is asked again for the
 * one after: the models seldom change, and the CLI can take its time.
 */
export function createModelCatalogue(list: () => Promise<ModelOption[]>, now: () => number = Date.now): ModelCatalogue {
  let cached: { models: ModelOption[]; expiresAt: number } | undefined;
  let pending: Promise<ModelOption[]> | undefined;
  const refresh = () =>
    (pending ??= list().then((models) => {
      cached = { models, expiresAt: now() + MODEL_CACHE_TTL_MS };
      return [...models];
    }).finally(() => {
      pending = undefined;
    }));
  return {
    get() {
      if (!cached) return refresh();
      // One that can't be listed any more leaves the last list standing.
      if (now() >= cached.expiresAt) refresh().catch(() => {});
      return Promise.resolve([...cached.models]);
    },
  };
}

/** Every provider's catalogue, for an office whose `command(provider)` runs that provider's CLI in `cwd`. */
export function createModelCatalogues(command: (provider: AgentProvider) => string, cwd: string): Partial<Record<AgentProvider, ModelCatalogue>> {
  const catalogues: Partial<Record<AgentProvider, ModelCatalogue>> = {};
  for (const [provider, list] of Object.entries(MODEL_LISTERS) as [AgentProvider, ModelLister][]) {
    catalogues[provider] = createModelCatalogue(() => list(command(provider), cwd));
  }
  return catalogues;
}
