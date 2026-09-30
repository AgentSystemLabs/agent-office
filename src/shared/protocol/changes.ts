// What a worker changed in its checkout, for the Changes window.

export type ChangeStatus = 'M' | 'A' | 'D' | 'R' | 'T' | '?';

/** One file a worker changed, against the base of its branch. */
export interface ChangedFile {
  path: string;
  /** The old path, when the file was renamed. */
  from?: string;
  /** M modified, A added, D deleted, R renamed, T type changed, ? untracked (new, never committed). */
  status: ChangeStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  /** Not committed yet: staged, unstaged or untracked. */
  uncommitted: boolean;
  /** Fingerprint of the working copy (size and mtime); a new value means the diff changed. */
  sig: string;
}

/** Changed files the Changes window can show as a picture (GET /api/changes/file), by extension. */
const CHANGED_IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

/** The content type of a changed picture, or undefined when the file isn't one. */
export function changedImageType(filePath: string): string | undefined {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const ext = name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(CHANGED_IMAGE_TYPES, ext) ? CHANGED_IMAGE_TYPES[ext] : undefined;
}

/** What a worker changed in its checkout, against the branch the office was opened on. */
export interface ChangesState {
  workerId: string;
  /** For a worker across repositories: the floor of the repository this is (see WorkerInfo.repos); none for its own floor's. */
  repo?: string;
  /** The checkout, relative to the office dir ('' is the project folder itself, shared by everyone). */
  dir: string;
  /** Current branch of that checkout ('HEAD' when detached). */
  branch?: string;
  /** What the diff is against: the base branch, an upstream, or 'HEAD' (uncommitted changes only). */
  base: string;
  /** Commits on the branch since the base. */
  ahead: number;
  /** Subject of the newest commit, when ahead > 0. */
  subject?: string;
  files: ChangedFile[];
  /** Files left out because there were more than the office lists. */
  more: number;
  /** The branch a pull request would target, when this checkout is on a branch of its own. */
  prBase?: string;
  /** An open pull request for the branch. */
  pr?: { number: number; url: string };
  /** A commit, discard or pull request in progress. */
  busy?: string;
  error?: string;
  at: number;
}

export type ChangesClientMsg =
  /**
   * Follow what a worker changed (the office polls its checkout while anyone watches). `repo` picks
   * one of the other floors' repositories a worker across repositories works in (see WorkerInfo.repos).
   */
  | { t: 'changes.watch'; workerId: string; repo?: string }
  | { t: 'changes.unwatch'; workerId: string; repo?: string }
  | { t: 'changes.diff'; workerId: string; path: string; repo?: string }
  | { t: 'changes.commit'; workerId: string; message: string; repo?: string }
  /** Without a path, throws away every uncommitted change in that checkout. */
  | { t: 'changes.discard'; workerId: string; path?: string; repo?: string }
  | { t: 'changes.pr'; workerId: string; title: string; body: string; repo?: string };

export type ChangesServerMsg =
  /** Sent to whoever watches that worker's changes, whenever they change. */
  | { t: 'changes'; state: ChangesState }
  | { t: 'changes.diff'; workerId: string; repo?: string; path: string; diff: string; truncated: boolean; error?: string };
