// The page's state: the store (./store.ts), made of the core and every slice (./slices), and what this
// browser remembers between visits (./persist.ts).

import { SLICES } from './slices';
import { Store } from './store';

export { AVATAR_COLORS, HUD_DEFAULTS, NEEDS_YOU_SOUNDS, lastFloor, lastSpot, loadProfile, loadSettings, rememberSpot, saveProfile, saveSettings } from './persist';
export type { HudPanel, NeedsYouSound, Profile, Settings, Spot, ViewMode } from './persist';
export { workerForPull } from './store';
export type { ScreenState, Slice, Store, Topic, Topics } from './store';

export const store = new Store(SLICES);
