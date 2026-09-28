// The building: every project is a floor you ride the elevator to. Shared by the server (which
// assigns each floor its look) and the client (which paints it).

/** The most floors a building has. */
export const MAX_FLOORS = 16;

/** How a floor looks: its walls, their trim, and its planks. */
export interface FloorPalette {
  name: string;
  wall: string;
  trim: string;
  floor: string;
  floorAlt: string;
  /** The gaps between planks. */
  seam: string;
}

/**
 * How a floor looks, in the industrial palette: charcoal walls, concrete or dark wood floors, and a
 * trim color that keeps every floor distinguishable from the next. The first is the office's own
 * look; every new floor takes the next one nobody has.
 */
export const FLOOR_PALETTES: FloorPalette[] = [
  { name: 'Graphite', wall: '#26292f', trim: '#ee6018', floor: '#34383f', floorAlt: '#30343b', seam: '#1f2226' },
  { name: 'Steel', wall: '#2a2e34', trim: '#8fa3b8', floor: '#3b4048', floorAlt: '#363b42', seam: '#23262b' },
  { name: 'Concrete', wall: '#2e3136', trim: '#72ddf7', floor: '#3f434a', floorAlt: '#3a3e45', seam: '#26292e' },
  { name: 'Walnut', wall: '#33302c', trim: '#c99559', floor: '#433a30', floorAlt: '#3d352c', seam: '#2a2521' },
  { name: 'Moss', wall: '#2c312d', trim: '#6fae7f', floor: '#3a403b', floorAlt: '#353b36', seam: '#232824' },
  { name: 'Plum', wall: '#2e2a33', trim: '#b689ef', floor: '#3c3842', floorAlt: '#37333d', seam: '#252329' },
  { name: 'Slate', wall: '#2b2f36', trim: '#5aa9e6', floor: '#3d424a', floorAlt: '#383d45', seam: '#24272d' },
  { name: 'Umber', wall: '#322e2a', trim: '#f2b84b', floor: '#423931', floorAlt: '#3c342d', seam: '#292420' },
  { name: 'Harbor', wall: '#2a3033', trim: '#3ccf91', floor: '#3a4144', floorAlt: '#353c3f', seam: '#222829' },
  { name: 'Ember', wall: '#302b2b', trim: '#f27e93', floor: '#3e3838', floorAlt: '#393333', seam: '#262222' },
];

export function floorPalette(i: number): FloorPalette {
  return FLOOR_PALETTES[((i % FLOOR_PALETTES.length) + FLOOR_PALETTES.length) % FLOOR_PALETTES.length];
}

/**
 * `owner/repo` from what someone typed or pasted: owner/repo, a github.com URL (https, ssh or
 * git@), with or without .git. Undefined for anything else, so it can never become a CLI option,
 * a path or another host.
 */
export function normalizeRepo(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let s = value.trim();
  if (s.length > 200) return undefined;
  s = s.replace(/^(?:https?:\/\/|ssh:\/\/)?(?:[\w.-]+@)?github\.com[/:]/i, '');
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  const parts = s.split('/');
  // A URL may go on past the repository (…/owner/repo/issues/12).
  if (parts.length < 2) return undefined;
  const [owner, repo] = parts;
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(owner)) return undefined;
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(repo) || repo === '.' || repo === '..') return undefined;
  return `${owner}/${repo}`;
}

export function sameRepo(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
