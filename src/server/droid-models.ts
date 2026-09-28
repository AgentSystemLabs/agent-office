import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { isAgentEffort, type AgentEffort } from '../shared/protocol.js';
import { DROID_MODEL_MAX, isValidDroidModel } from './agents.js';

export const DROID_SETTINGS_PATH = path.join(homedir(), '.factory', 'settings.json');
export const DROID_CATALOGUE_TTL_MS = 60_000;

/** A Droid model the hire dialog can offer: a custom model from settings, or the session default. */
export interface DroidModelOption {
  id: string;
  /** The display name from settings, or the id when settings has none. */
  displayName: string;
  defaultReasoningEffort?: AgentEffort;
  supportedReasoningEfforts?: AgentEffort[];
}

export interface DroidModelCatalogue {
  /** Every selectable model, custom models first, in settings order. */
  models: DroidModelOption[];
  /** The global default model droid runs without an override, when settings names a valid one. */
  defaultModel?: string;
  defaultReasoningEffort?: AgentEffort;
}

function effort(value: unknown): AgentEffort | undefined {
  return isAgentEffort(value) ? value : undefined;
}

function efforts(value: unknown): AgentEffort[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter(isAgentEffort);
  return out.length ? [...new Set(out)] : undefined;
}

/**
 * The models droid can run, from its own settings file: every `customModels` entry, plus the
 * session default and favorited ids when settings names ones that aren't custom models (built-ins
 * like `glm-5.3-flash` never appear in `customModels`). A bad id in an overlay silently runs the
 * default model instead, so only well-shaped ids are listed.
 */
export function readDroidModels(settingsPath: string = DROID_SETTINGS_PATH): DroidModelCatalogue {
  const models: DroidModelOption[] = [];
  const seen = new Set<string>();
  const add = (id: unknown, displayName?: unknown, fallback?: AgentEffort, supported?: AgentEffort[]) => {
    if (!isValidDroidModel(id) || id.length > DROID_MODEL_MAX || seen.has(id)) return;
    seen.add(id);
    models.push({
      id,
      displayName: typeof displayName === 'string' && displayName.trim() ? displayName.trim().slice(0, 120) : id,
      ...(fallback ? { defaultReasoningEffort: fallback } : {}),
      ...(supported ? { supportedReasoningEfforts: supported } : {}),
    });
  };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return { models };
  }
  if (!raw || typeof raw !== 'object') return { models };
  const custom = Array.isArray(raw.customModels) ? raw.customModels : [];
  for (const entry of custom) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    add(e.id, e.displayName, effort(e.defaultReasoningEffort) ?? effort(e.reasoningEffort), efforts(e.supportedReasoningEfforts));
  }
  const session = raw.sessionDefaultSettings as Record<string, unknown> | undefined;
  const defaultModel = isValidDroidModel(session?.model) ? (session.model as string) : undefined;
  const defaultReasoningEffort = effort(session?.reasoningEffort);
  if (defaultModel) add(defaultModel);
  const favorites = Array.isArray(raw.modelFavorites) ? raw.modelFavorites : [];
  for (const fav of favorites) add(fav);
  return { models, ...(defaultModel ? { defaultModel } : {}), ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}) };
}

export interface DroidCatalogue {
  get(): Promise<DroidModelCatalogue>;
}

/** The catalogue, cached briefly: settings change when the user edits models, not mid-hire. */
export function createDroidModelCatalogue(settingsPath: string = DROID_SETTINGS_PATH, now: () => number = Date.now): DroidCatalogue {
  let cached: { catalogue: DroidModelCatalogue; expiresAt: number } | undefined;
  return {
    get() {
      const current = now();
      if (cached && current < cached.expiresAt) return Promise.resolve(cached.catalogue);
      const catalogue = readDroidModels(settingsPath);
      cached = { catalogue, expiresAt: now() + DROID_CATALOGUE_TTL_MS };
      return Promise.resolve(catalogue);
    },
  };
}
