import { pocketRuntime } from './runtime';

let customize: (() => void) | undefined;

/** The transport owns the callback and removes it when its iframe closes. */
export function registerPocketCustomize(open: () => void): () => void {
  customize = open;
  return () => { if (customize === open) customize = undefined; };
}

/** True means the native flow owns this action; never render the standalone form. */
export function openPocketCustomize(): boolean {
  if (!pocketRuntime()) return false;
  if (!customize) throw new Error('Pocket is not connected. Reopen the Office panel to customize your avatar.');
  customize();
  return true;
}
