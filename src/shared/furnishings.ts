// The wardrobe (features/wardrobe/): what a floor's furnishings look like, swapped from the wardrobe by
// the exit door. Each slot is a kind of thing round the room, with the looks it can have; the first of
// each is the one a floor starts with, which is how the office has always looked.

/** One look a slot can have: its name, and the colors its swatch in the wardrobe shows (and the 3D one uses). */
export interface FurnishVariant {
  id: string;
  label: string;
  colors: readonly string[];
}

export interface FurnishSlot {
  label: string;
  icon: string;
  variants: readonly FurnishVariant[];
}

export const FURNISH_SLOTS = {
  plants: {
    label: 'Plants',
    icon: '🪴',
    variants: [
      { id: 'mixed', label: 'Mixed', colors: ['#5fb760', '#3f8f45', '#e76f51'] },
      { id: 'monstera', label: 'Monstera', colors: ['#5fb760', '#e76f51'] },
      { id: 'snake_plant', label: 'Snake plants', colors: ['#3f8f45', '#8ecae6'] },
      { id: 'ficus', label: 'Ficus', colors: ['#5fb760', '#8a5a3b'] },
    ],
  },
  rugs: {
    label: 'Rugs',
    icon: '🟪',
    // The desk clusters' four rugs, then the lounge's.
    variants: [
      { id: 'pastel', label: 'Pastel', colors: ['#bde0fe', '#ffd6a5', '#caffbf', '#ffc6ff', '#ffc6ff'] },
      { id: 'ocean', label: 'Ocean', colors: ['#90e0ef', '#ade8f4', '#48cae4', '#caf0f8', '#00b4d8'] },
      { id: 'forest', label: 'Forest', colors: ['#b7e4c7', '#95d5b2', '#d8f3dc', '#74c69d', '#52b788'] },
      { id: 'sunset', label: 'Sunset', colors: ['#ffb4a2', '#ffcdb2', '#f4a261', '#e5989b', '#e76f51'] },
      { id: 'none', label: 'Bare floor', colors: [] },
    ],
  },
  lamps: {
    label: 'Lamps',
    icon: '💡',
    // The shade, then the bulb's glow.
    variants: [
      { id: 'cone', label: 'Cone', colors: ['#ffd166', '#ffe08a'] },
      { id: 'globe', label: 'Globe', colors: ['#fff7d6', '#ffe08a'] },
      { id: 'drum', label: 'Drum', colors: ['#2a9d8f', '#ffe08a'] },
      { id: 'disco', label: 'Disco', colors: ['#ef476f', '#ff8fab'] },
    ],
  },
  sofa: {
    label: 'Sofa',
    icon: '🛋️',
    // The sofa, then the poufs either side of the lounge.
    variants: [
      { id: 'blue', label: 'Blue', colors: ['#5b8def', '#06d6a0', '#ffd166'] },
      { id: 'green', label: 'Green', colors: ['#2a9d8f', '#e9c46a', '#f4a261'] },
      { id: 'red', label: 'Red', colors: ['#e63946', '#f1faee', '#a8dadc'] },
      { id: 'grey', label: 'Grey', colors: ['#8d99ae', '#edf2f4', '#ef233c'] },
      { id: 'mustard', label: 'Mustard', colors: ['#e9c46a', '#264653', '#2a9d8f'] },
    ],
  },
} as const satisfies Record<string, FurnishSlot>;

export type FurnishSlotId = keyof typeof FURNISH_SLOTS;
export const FURNISH_SLOT_IDS = Object.keys(FURNISH_SLOTS) as FurnishSlotId[];

/** A floor's furnishings: the variant each slot has. */
export type Furnishings = Record<FurnishSlotId, string>;

/** How a floor starts out: the first variant of every slot. */
export function defaultFurnishings(): Furnishings {
  return Object.fromEntries(FURNISH_SLOT_IDS.map((s) => [s, FURNISH_SLOTS[s].variants[0].id])) as Furnishings;
}

export function isSlot(x: unknown): x is FurnishSlotId {
  return typeof x === 'string' && Object.hasOwn(FURNISH_SLOTS, x);
}

/** Slot `slot`'s variant `id`, or undefined when it has none of that name. */
export function variantOf(slot: FurnishSlotId, id: unknown): FurnishVariant | undefined {
  return (FURNISH_SLOTS[slot].variants as readonly FurnishVariant[]).find((v) => v.id === id);
}

/** What a saved or sent set of furnishings comes to: every slot, each with a variant it has (its first, for one it hasn't). */
export function sanitizeFurnishings(x: unknown): Furnishings {
  const out = defaultFurnishings();
  if (!x || typeof x !== 'object') return out;
  for (const slot of FURNISH_SLOT_IDS) {
    const v = variantOf(slot, (x as Record<string, unknown>)[slot]);
    if (v) out[slot] = v.id;
  }
  return out;
}
