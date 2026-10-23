import { pocketRuntime } from './runtime';
import type { PocketFloor } from './floors';
import type { PocketSnapshot } from './wire';
export { pocketOverlay } from './overlay';

const snapshotListeners = new Set<(snapshot: PocketSnapshot) => void>();
export function onPocketSnapshot(fn: (snapshot: PocketSnapshot) => void): () => void {
  snapshotListeners.add(fn);
  return () => { snapshotListeners.delete(fn); };
}
export function publishPocketSnapshot(snapshot: PocketSnapshot): void {
  for (const fn of snapshotListeners) fn(snapshot);
}

let floorCallbacks: { list(): Promise<PocketFloor[]>; switch(source: number): Promise<void> } | undefined;

export function registerPocketFloors(callbacks: NonNullable<typeof floorCallbacks>): () => void {
  floorCallbacks = callbacks;
  return () => { if (floorCallbacks === callbacks) floorCallbacks = undefined; };
}
export function listPocketFloors(): Promise<PocketFloor[]> {
  if (!floorCallbacks) return Promise.reject(new Error('Pocket floor connection is unavailable. Reopen the Office.'));
  return floorCallbacks.list();
}
export function switchPocketFloor(source: number): Promise<void> {
  if (!floorCallbacks) return Promise.reject(new Error('Pocket floor connection is unavailable. Reopen the Office.'));
  return floorCallbacks.switch(source);
}

let customize: (() => void) | undefined;
let workspace: (() => void) | undefined;

/** The transport owns the callback and removes it when its iframe closes. */
export function registerPocketCustomize(open: () => void): () => void {
  customize = open;
  return () => { if (customize === open) customize = undefined; };
}
export function registerPocketWorkspace(open: () => void): () => void {
  workspace = open;
  return () => { if (workspace === open) workspace = undefined; };
}

/** True means the native flow owns this action; never render the standalone form. */
export function openPocketCustomize(): boolean {
  if (!pocketRuntime()) return false;
  if (!customize) throw new Error('Pocket is not connected. Reopen the Office panel to customize your avatar.');
  customize();
  return true;
}

/** The project's elevator is a workspace picker in Pocket, not a repository clone dialog. */
export function openPocketWorkspace(): boolean {
  if (!pocketRuntime()) return false;
  if (!workspace) throw new Error('Pocket is not connected. Reopen the Office panel to switch workspaces.');
  document.exitPointerLock?.();
  workspace();
  return true;
}
