// Files dropped or pasted into a worker's terminal: the browser sends them to the office, which keeps
// them on its own machine (see server/drops.ts), and the terminal types where they are, as a terminal
// does with a file dragged into it. Claude Code and Codex turn a pasted picture's path into an image.

/** The biggest file that can be dropped into a terminal: plenty for a screenshot of a big screen. */
export const DROP_MAX_BYTES = 25 * 1024 * 1024;

/**
 * What a terminal types for files dragged into it, one path after another: a Windows path in quotes
 * when it has spaces, any other with a backslash before each character a shell would split it on.
 */
export function droppedPaths(paths: string[]): string {
  return paths.map((p) => (/^[a-z]:[\\/]/i.test(p) ? (/\s/.test(p) ? `"${p}"` : p) : p.replace(/[^\p{L}\p{N}_@%+=:,./-]/gu, '\\$&'))).join(' ');
}
