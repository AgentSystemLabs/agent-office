// The rooftop café: the roof of the building, over its top floor. Nobody works up there. There's a café
// counter to order a coffee or a bite at, tables under string lights, sun loungers, a couple of games
// and the city all around. No alcohol, and nothing with pork in it. The elevator goes up there from
// every floor. Shared by the server (who's up there, what they're holding) and the client (which builds it).

/**
 * Where you are while you're on the roof (a peer's `floor`, and `floor.go`'s). It can never be a
 * project floor's id, which is only ever lowercase letters, digits and dashes.
 */
export const ROOF = '@roof';
export const ROOF_NAME = 'Rooftop café';

/** What an item comes in: an espresso-sized cup, a mug, a tall glass or a plate. */
export type Vessel = 'cup' | 'mug' | 'tall' | 'plate';

export type ItemId =
  | 'espresso'
  | 'cappuccino'
  | 'flatwhite'
  | 'mintTea'
  | 'blackTea'
  | 'orangeJuice'
  | 'lemonade'
  | 'sparkling'
  | 'hotChocolate'
  | 'croissant'
  | 'almondCroissant'
  | 'painAuChocolat'
  | 'toastie'
  | 'avocadoToast'
  | 'fruitCup'
  | 'bagel'
  | 'falafelWrap';

export interface MenuItem {
  id: ItemId;
  kind: 'drink' | 'food';
  name: string;
  emoji: string;
  /** What the menu says about it. */
  blurb: string;
  /** The drink in the cup, or the main color of the food. */
  color: string;
  vessel: Vessel;
}

export const DRINKS: readonly MenuItem[] = [
  { id: 'espresso', kind: 'drink', name: 'Espresso', emoji: '☕', blurb: 'Short, dark and a little sweet', color: '#4a2c1a', vessel: 'cup' },
  { id: 'cappuccino', kind: 'drink', name: 'Cappuccino', emoji: '☕', blurb: 'Steamed milk, a cloud of foam', color: '#c89f78', vessel: 'cup' },
  { id: 'flatwhite', kind: 'drink', name: 'Flat white', emoji: '☕', blurb: 'Velvety milk over a double shot', color: '#b98a62', vessel: 'mug' },
  { id: 'mintTea', kind: 'drink', name: 'Mint tea', emoji: '🍵', blurb: 'Fresh leaves, hot water, nothing else', color: '#c5dd8c', vessel: 'tall' },
  { id: 'blackTea', kind: 'drink', name: 'Black tea', emoji: '🫖', blurb: 'Strong, with a splash of milk if you like', color: '#9a5b2e', vessel: 'mug' },
  { id: 'orangeJuice', kind: 'drink', name: 'Fresh orange juice', emoji: '🍊', blurb: 'Squeezed this morning', color: '#ffa62b', vessel: 'tall' },
  { id: 'lemonade', kind: 'drink', name: 'Lemonade', emoji: '🍋', blurb: 'Tart, sweet and very cold', color: '#f7e26b', vessel: 'tall' },
  { id: 'sparkling', kind: 'drink', name: 'Sparkling water', emoji: '💧', blurb: 'With a slice of lime', color: '#d6f1ff', vessel: 'tall' },
  { id: 'hotChocolate', kind: 'drink', name: 'Hot chocolate', emoji: '🍫', blurb: 'Thick, dark and properly hot', color: '#5a3320', vessel: 'mug' },
];

export const FOODS: readonly MenuItem[] = [
  { id: 'croissant', kind: 'food', name: 'Butter croissant', emoji: '🥐', blurb: 'Flaky, golden, still warm', color: '#d9953b', vessel: 'plate' },
  { id: 'almondCroissant', kind: 'food', name: 'Almond croissant', emoji: '🥐', blurb: 'Filled with almond cream, dusted with sugar', color: '#cf9a52', vessel: 'plate' },
  { id: 'painAuChocolat', kind: 'food', name: 'Pain au chocolat', emoji: '🍫', blurb: 'Two bars of dark chocolate inside', color: '#c98430', vessel: 'plate' },
  { id: 'toastie', kind: 'food', name: 'Cheese & tomato toastie', emoji: '🥪', blurb: 'Melted cheddar, sliced tomato, toasted', color: '#e0a64a', vessel: 'plate' },
  { id: 'avocadoToast', kind: 'food', name: 'Avocado toast', emoji: '🥑', blurb: 'Sourdough, lime and chilli flakes', color: '#8fb85a', vessel: 'plate' },
  { id: 'fruitCup', kind: 'food', name: 'Fruit cup', emoji: '🍓', blurb: 'Strawberries, orange and blueberries', color: '#e5484d', vessel: 'plate' },
  { id: 'bagel', kind: 'food', name: 'Bagel with cream cheese', emoji: '🥯', blurb: 'Plain, toasted, a thick spread', color: '#d8a964', vessel: 'plate' },
  { id: 'falafelWrap', kind: 'food', name: 'Falafel wrap', emoji: '🌯', blurb: 'Chickpea falafel, hummus, crunchy salad', color: '#d9b779', vessel: 'plate' },
];

/** The whole menu: drinks, then food. */
export const MENU: readonly MenuItem[] = [...DRINKS, ...FOODS];

export const ITEM_BY_ID = new Map(MENU.map((i) => [i.id, i]));

export function isItem(v: unknown): v is ItemId {
  return typeof v === 'string' && ITEM_BY_ID.has(v as ItemId);
}
