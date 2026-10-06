// Triage's labels on GitHub: made in each repo the first time they're needed, with fixed colors, and
// how triage tells that a person changed them.
import { isOwnedLabel } from './route.js';

/** Runs gh in the floor's checkout. */
export type GhRun = (args: string[]) => Promise<string>;

const COLORS: Record<string, string> = {
  'type:': '1d76db',
  'area:': '5319e7',
  'size:': 'c5def5',
  'prio:': 'fbca04',
  'triage:': 'ededed',
};
const STATUS_COLORS: Record<string, string> = {
  'triage:queued': '0e8a16',
  'triage:ready': 'bfdadc',
  'triage:needs-human': 'b60205',
  'triage:needs-detail': 'd93f0b',
  'triage:cross-repo': 'f9d0c4',
  'triage:split-me': 'e99695',
  'triage:low-confidence': 'fef2c0',
};

export function labelColor(name: string): string {
  return STATUS_COLORS[name] ?? COLORS[Object.keys(COLORS).find((p) => name.startsWith(p)) ?? ''] ?? 'ededed';
}

/** Makes the labels the repo doesn't have yet; `known` is what it has, and is added to. */
export async function ensureLabels(run: GhRun, names: string[], known: Set<string>): Promise<void> {
  for (const name of names) {
    if (known.has(name)) continue;
    try {
      await run(['label', 'create', name, '--color', labelColor(name), '--description', 'Set by agent-office triage']);
    } catch (err) {
      if (!/already exists/i.test((err as Error).message)) throw err;
    }
    known.add(name);
  }
}

/** The owned labels to put on and take off to get from what an issue has to what triage wants. */
export function labelDiff(current: string[], wanted: string[]): { add: string[]; remove: string[] } {
  const owned = current.filter(isOwnedLabel);
  return { add: wanted.filter((l) => !owned.includes(l)), remove: owned.filter((l) => !wanted.includes(l)) };
}

/**
 * Someone changed triage's labels: the issue's owned labels aren't the ones triage last wrote. With
 * none written yet, any it has were put on by a person.
 */
export function humanOverrode(current: string[], written: string[] | undefined): boolean {
  const owned = current.filter(isOwnedLabel).sort();
  if (!written) return owned.length > 0;
  const w = [...written].sort();
  return owned.length !== w.length || owned.some((l, i) => l !== w[i]);
}
