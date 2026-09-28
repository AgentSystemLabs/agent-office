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

/** Where a floor's repository is hosted, which decides whether `gh` or `glab` talks to it. */
export type Forge = 'github' | 'gitlab';

/** The GitLab instance a bare group/subgroup/project path means. */
export const DEFAULT_GITLAB_HOST = 'gitlab.com';

const GH_OWNER = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const GH_NAME = /^[a-zA-Z0-9_.-]{1,100}$/;
const HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const GL_SEGMENT = /^[a-zA-Z0-9_](?:[a-zA-Z0-9_.-]{0,253}[a-zA-Z0-9_-])?$/;
/** GitLab nests groups up to 20 deep, plus the project. */
const GL_MAX_SEGMENTS = 21;

/**
 * A repository from what someone typed or pasted, or from a checkout's remote URL. GitHub
 * repositories come back as `owner/repo` (owner/repo, or a github.com URL: https, ssh or git@).
 * GitLab projects come back as `host/group/…/project` (a URL on any other host, host/group/project,
 * or a bare path of three or more segments, which means gitlab.com). Undefined for anything else,
 * so it can never become a CLI option or a path outside the projects folder.
 */
export function normalizeRepo(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let s = value.trim();
  if (s.length > 400) return undefined;
  let host: string | undefined;
  const url = /^(?:(?:https?|ssh|git):\/\/)?(?:[\w.~%-]+@)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?::\d+)?[/:](.*)$/.exec(s);
  if (url) {
    host = url[1].toLowerCase();
    s = url[2];
  } else if (/^[a-z]+:\/\//i.test(s) || s.includes('@')) {
    return undefined;
  }
  s = s.replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '');
  if (host && host !== 'github.com') return gitlabRepo(host, s);
  if (!host && s.split('/').length >= 3) return gitlabRepo(DEFAULT_GITLAB_HOST, s);
  const parts = s.replace(/\.git$/i, '').split('/');
  // A URL may go on past the repository (…/owner/repo/issues/12).
  if (parts.length < 2) return undefined;
  const [owner, repo] = parts;
  if (!GH_OWNER.test(owner)) return undefined;
  if (!GH_NAME.test(repo) || repo === '.' || repo === '..') return undefined;
  return `${owner}/${repo}`;
}

function gitlabRepo(host: string, rest: string): string | undefined {
  if (!HOST.test(host)) return undefined;
  // Pages of a project (…/project/-/merge_requests/12) sit after its /-/.
  const parts = rest
    .replace(/\/-(?:\/.*)?$/, '')
    .replace(/\.git$/i, '')
    .split('/');
  if (parts.length < 2 || parts.length > GL_MAX_SEGMENTS) return undefined;
  if (!parts.every((p) => GL_SEGMENT.test(p) && !/\.(?:git|atom)$/i.test(p))) return undefined;
  return `${host}/${parts.join('/')}`;
}

/** GitLab repositories carry their host; GitHub's are plain owner/repo. */
export function forgeOf(repo: string | undefined): Forge | undefined {
  if (!repo) return undefined;
  return repo.split('/')[0].includes('.') ? 'gitlab' : 'github';
}

/** A GitLab repository's instance and its group/…/project path. */
export function gitlabParts(repo: string): { host: string; path: string } {
  const i = repo.indexOf('/');
  return { host: repo.slice(0, i), path: repo.slice(i + 1) };
}

/** The repository's path on its host: owner/repo on GitHub, group/…/project on GitLab. */
export function repoPath(repo: string): string {
  return forgeOf(repo) === 'gitlab' ? gitlabParts(repo).path : repo;
}

/** The repository's home page. */
export function repoWebUrl(repo: string): string {
  return forgeOf(repo) === 'gitlab' ? `https://${repo}` : `https://github.com/${repo}`;
}

/** How a forge names things, for text shown to people and prompts given to workers. */
export interface ForgeWords {
  site: 'GitHub' | 'GitLab';
  cli: 'gh' | 'glab';
  /** "PR" or "MR". */
  pr: string;
  /** "pull request" or "merge request". */
  pull: string;
  /** How a pull request is referenced in text: #12 on GitHub, !12 on GitLab. */
  ref(n: number): string;
}

const WORDS: Record<Forge, ForgeWords> = {
  github: { site: 'GitHub', cli: 'gh', pr: 'PR', pull: 'pull request', ref: (n) => `#${n}` },
  gitlab: { site: 'GitLab', cli: 'glab', pr: 'MR', pull: 'merge request', ref: (n) => `!${n}` },
};

/** GitHub's words unless the forge is GitLab. */
export function forgeWords(forge: Forge | undefined): ForgeWords {
  return WORDS[forge ?? 'github'];
}

export function sameRepo(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
