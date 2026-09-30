import type { GhMergeMethod } from '../../../shared/protocol';

// What the windows remember in this browser: how you last merged, the Files tab's layout, which tab
// you were on, and the comment you were writing.

export function pref<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // storage blocked
  }
}

export const MERGE_KEY = 'agent-office.merge';
export const FILES_KEY = 'agent-office.pr-files';
export const TAB_KEY = 'agent-office.pr-tab';
/** Followed by the issue or PR's URL: the comment you were writing there. */
export const DRAFT_KEY = 'agent-office.comment:';

interface MergePref {
  method?: GhMergeMethod;
  deleteBranch?: boolean;
}

export function mergePref(methods: GhMergeMethod[]): { method: GhMergeMethod; deleteBranch: boolean } {
  const p = pref<MergePref>(MERGE_KEY, {});
  return { method: p.method && methods.includes(p.method) ? p.method : methods[0], deleteBranch: p.deleteBranch ?? true };
}
