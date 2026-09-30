/**
 * Hiring, as the 3D office and the 2D view (/lite) both do it. No three.js here: the 2D view imports it.
 */
import { store } from '../state';

/** The building's other projects a new worker can work in too, each in a worktree of its own (see WorkerInfo.repos). */
export function repoChoices(): { id: string; name: string }[] {
  return store.floors.filter((f) => f.id !== store.floor && f.branch && !f.cloning).map((f) => ({ id: f.id, name: f.name }));
}
