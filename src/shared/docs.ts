// The bookshelf: the project's Markdown files, listed by the office (server/docs.ts) and read in a
// window in the office (features/bookshelf/ui.ts).

/** One Markdown file in the project. */
export interface DocFile {
  /** From the project folder, with forward slashes: "docs/setup.md". */
  path: string;
  /** Its first heading (or front matter title), when it has one near the top. */
  title?: string;
  size: number;
  /** Last modified, ms since epoch. */
  mtime: number;
}

/** What GET /api/docs answers: every Markdown file in the floor's project, by path. */
export interface DocList {
  files: DocFile[];
  /** There were more than the office lists. */
  more: boolean;
}

/** What GET /api/docs/file answers. */
export interface DocText {
  path: string;
  text: string;
}

/** A file the bookshelf shows: Markdown, by its extension. */
export function isDocPath(p: string): boolean {
  return /\.(md|markdown)$/i.test(p) && !/(^|\/)\.\.?(\/|$)/.test(p);
}

/**
 * Where a link in the doc at `from` goes in the project, as a path from the project folder, with any
 * #anchor apart: "../README.md#setup" from "docs/a.md" is { path: "README.md", hash: "setup" }. A link
 * starting with / is from the project folder, as on GitHub. Undefined for links elsewhere (another
 * site, mailto:…) or out of the project.
 */
export function resolveDocLink(from: string, href: string): { path: string; hash: string } | undefined {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return undefined;
  const hashAt = href.indexOf('#');
  const hash = hashAt >= 0 ? href.slice(hashAt + 1) : '';
  let rel = (hashAt >= 0 ? href.slice(0, hashAt) : href).replace(/\?.*$/, '');
  try {
    rel = decodeURIComponent(rel);
  } catch {
    return undefined;
  }
  // Just an anchor: somewhere in this same doc.
  if (!rel) return { path: from, hash };
  const parts = rel.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.length ? { path: parts.join('/'), hash } : undefined;
}
