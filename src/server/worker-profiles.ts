import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isAgentEffort, isAgentProvider } from '../shared/protocol.js';
import type { WorkerProfile } from '../shared/worker-profiles.js';
import { validateWorkerEffort, validateWorkerModel } from './agents.js';

export function parseWorkerProfiles(value: unknown): WorkerProfile[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Profiles must be a list of at most 100 entries');
  const ids = new Set<string>();
  const names = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid worker profile');
    const row = raw as Record<string, unknown>;
    const text = (key: string, maximum: number) => typeof row[key] === 'string' && (row[key] as string).length <= maximum && !/[\x00-\x1f\x7f]/.test(row[key] as string) ? (row[key] as string).trim() : '';
    const id = text('id', 100), name = text('name', 80);
    if (!id || !name || ids.has(id) || names.has(name)) throw new Error('Worker profile ids and names must be unique and nonempty');
    ids.add(id); names.add(name);
    const provider = isAgentProvider(row.provider) && row.provider !== 'custom' ? row.provider : undefined;
    const model = text('model', 256) || undefined;
    const effort = isAgentEffort(row.effort) ? row.effort : undefined;
    const holds = Array.isArray(row.holds) ? row.holds.filter((x): x is string => typeof x === 'string').map(x => x.slice(0, 200)).slice(0, 20) : [];
    if (!provider) holds.push('Provider is not configured');
    if (!model) holds.push('Model is unspecified');
    if (provider && validateWorkerModel('agent', provider, model)) holds.push('Model is invalid for this provider');
    if (provider && validateWorkerEffort('agent', provider, effort)) holds.push('Effort is invalid for this provider');
    if (provider !== 'cursor' && !effort) holds.push('Effort is unspecified; no fallback is applied');
    if (row.enabled !== true && holds.length === 0) holds.push('Profile is held by its source');
    return { id, name, description: text('description', 4000), provider, model, effort,
      enabled: row.enabled === true && holds.length === 0, holds, source: text('source', 500) || undefined };
  });
}

export function loadWorkerProfiles(dataDir: string): WorkerProfile[] {
  const file = path.join(dataDir, 'worker-profiles.json');
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512_000) throw new Error('Invalid worker profiles file');
    return parseWorkerProfiles(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export function profilePrompt(profile: WorkerProfile, prompt: string): string {
  return `Named worker: ${profile.name}.\nResponsibilities: ${profile.description}\n` +
    'Keep the requested model and reasoning effort. Preserve source holds, dependencies and independent QA. ' +
    'Do not change other workers or production services beyond this request. The persona is not a shared-memory author identity.\n\n' + prompt.trim();
}
