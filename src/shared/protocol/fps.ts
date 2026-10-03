import type { FpsInput, FpsShot, FpsState } from '../fps.js';
import type { BotOptions } from '../fps-bots.js';
export type FpsClientMsg = { t: 'fps.join' } | { t: 'fps.practice'; bot: BotOptions } | { t: 'fps.bot'; bot: BotOptions }
  | { t: 'fps.leave' } | { t: 'fps.reload' } | { t: 'fps.rematch' } | { t: 'fps.input'; input: FpsInput };
export type FpsServerMsg = { t: 'fps.state'; state: FpsState } | { t: 'fps.shot'; shot: FpsShot };
