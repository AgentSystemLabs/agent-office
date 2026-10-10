import type { PlaytestState } from '../../../shared/playtests';
type Listener = (floor: string | null, state: PlaytestState) => void;
const listeners = new Set<Listener>();
/** The modal and board share successful responses, without adding state to the global store. */
export const playtestUpdates = {
  publish(floor: string | null, state: PlaytestState) { for (const listener of listeners) listener(floor, state); },
  on(listener: Listener) { listeners.add(listener); return () => listeners.delete(listener); },
};
