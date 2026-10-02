import type { FpsInput, FpsShot, FpsState } from '../fps.js';
export type FpsClientMsg = { t: 'fps.join' } | { t: 'fps.leave' } | { t: 'fps.reload' } | { t: 'fps.rematch' } | { t: 'fps.input'; input: FpsInput };
export type FpsServerMsg = { t: 'fps.state'; state: FpsState } | { t: 'fps.shot'; shot: FpsShot };
