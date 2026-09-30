import type { ForgeKind, GhMergeMethod } from './protocol.js';
import { FORGE_CLI, FORGE_LABEL } from './protocol.js';

// Where a forge keeps the things an issue or pull request's text points at, and the office's own
// command to merge one. The office reads GitHub and Bitbucket into the same shapes (see
// server/forge.ts), which is what made it easy to leave every link in the office built for GitHub
// alone: `https://github.com/owner/repo/pull/12` and `https://bitbucket.org/owner/repo/pull-requests/12`
// go back to the repository in different ways, and Bitbucket keeps a person, a file and an issue in
// different places again. So everything here is worked out from the host in the URL it is given.

/** What a forge calls its own web address, and where each kind of thing lives under it. */
export interface ForgeWeb {
  kind: ForgeKind;
  /** What a link out of the office says it opens: "Open on GitHub ↗". */
  label: string;
  /** The CLI the office reads this forge with, for a command somebody is going to type. */
  cli: string;
  /** A person's page, from the name written in the text. */
  person(name: string): string;
  /**
   * Where a repository's issues are, or undefined when the forge has none to point at: Bitbucket
   * Cloud's issues belong to a whole workspace, so a #12 in a description has nowhere to go.
   */
  issues(repoUrl: string): string | undefined;
  /** A file at the tip of the default branch, with the anchor the link carried, if any. */
  file(repoUrl: string, path: string, anchor?: string): string;
  /**
   * The office's own merge command, as it goes into the prompt a worker is handed. `repo` is named
   * outright on GitHub, which is all `gh` has; bb reads the repository from the checkout instead.
   */
  merge(number: number, method: GhMergeMethod, deleteBranch: boolean, repo?: string): string;
}

const GITHUB: ForgeWeb = {
  kind: 'github',
  label: FORGE_LABEL.github,
  cli: FORGE_CLI.github,
  person: (name) => `https://github.com/${name}`,
  issues: (repo) => `${repo}/issues`,
  file: (repo, path, anchor) => `${repo}/blob/HEAD/${path}${anchor ? `#${anchor}` : ''}`,
  merge: (n, method, deleteBranch, repo) => `gh pr merge ${n} --${method}${deleteBranch ? ' --delete-branch' : ''}${repo ? ` --repo ${repo}` : ''}`,
};

/** How bb spells the three strategies the merge dialog offers, which are its own (see server/bitbucket.ts). */
const BB_STRATEGY: Record<GhMergeMethod, string> = { squash: 'squash', merge: 'merge_commit', rebase: 'rebase_fast_forward' };

const BITBUCKET: ForgeWeb = {
  kind: 'bitbucket',
  label: FORGE_LABEL.bitbucket,
  cli: FORGE_CLI.bitbucket,
  person: (name) => `https://bitbucket.org/${name}`,
  issues: () => undefined,
  // Bitbucket serves a file under /src, not /blob.
  file: (repo, path, anchor) => `${repo}/src/HEAD/${path}${anchor ? `#${anchor}` : ''}`,
  merge: (n, method, deleteBranch) => `bb pr merge ${n} --strategy ${BB_STRATEGY[method]}${deleteBranch ? ' --close-source-branch' : ''}`,
};

/** Which forge a URL on the web is on, from its host. GitHub is the fallback, as `forgeOf` is. */
export function webOf(url: string): ForgeWeb {
  return /bitbucket\.org/i.test(url) ? BITBUCKET : GITHUB;
}

/**
 * The repository an issue's or pull request's URL is on: /pull/12 and /issues/12 on GitHub,
 * /pull-requests/12 on Bitbucket, each with whatever the window is showing after it (/files, #diff…).
 */
export function repoOf(itemUrl: string): string {
  return itemUrl.replace(/\/(?:pull|pull-requests|issues)\/\d+.*$/, '');
}

/** Just the host a repository's URL is on, for a link that starts at the root. */
export function originOf(repoUrl: string): string {
  return /^(https?:\/\/[^/]+)/.exec(repoUrl)?.[1] ?? 'https://github.com';
}

/**
 * The line put on top of one of the office's own prompts, which are written for GitHub, before it
 * goes to whoever is working on a Bitbucket floor: the prompt is left exactly as written, since a
 * prompt someone rewrote in ⚙️ Settings is theirs word for word. `what` names the text being read
 * ("this brief", "the steps below"). Nothing at all on a GitHub floor.
 */
export function forgeNote(forge: ForgeKind, what: string): string {
  if (forge === 'github') return '';
  return `This project is on ${FORGE_LABEL[forge]}, not GitHub: use the ${FORGE_CLI[forge]} CLI wherever ${what} says \`${FORGE_CLI.github}\`, and keep off GitHub entirely.`;
}
