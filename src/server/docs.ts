import { execFile } from 'node:child_process';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { insideCheckout } from './changes.js';
import type { ImageResult } from './decor.js';
import { changedImageType } from '../shared/protocol.js';
import { isDocPath, type DocFile, type DocList, type DocText } from '../shared/docs.js';

// The bookshelf: every Markdown file in a floor's project, to read in the office (ui/bookshelf.ts).
// Git says which files are the project's (tracked, or new and not ignored), so node_modules, build
// output and the office's own .agent-office stay off the shelf. A folder that isn't a git checkout
// is walked instead, skipping the usual suspects.

const MAX_DOCS = 5000;
const MAX_DOC_BYTES = 2 * 1024 * 1024;
/** Pictures a doc shows, served from the project. */
const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
/** How much of each file is read for its title. */
const HEAD_BYTES = 4096;
/** A listing this fresh is handed out again rather than asking git. */
const FRESH_MS = 3000;
/** Folders the walk (without git) doesn't go into, besides hidden ones. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'coverage', '__pycache__', 'venv']);
const MAX_DEPTH = 12;

type Failure = { status: number; error: string };

/** The paths git lists, or undefined when the folder isn't in a git checkout (or there's no git). */
function gitDocs(dir: string): Promise<string[] | undefined> {
  const args = ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ':(icase)*.md', ':(icase)*.markdown'];
  return new Promise((resolve) => {
    execFile('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout) => {
      if (err) return resolve(undefined);
      resolve([...new Set(stdout.split('\0').filter(Boolean))]);
    });
  });
}

/** Without git: the Markdown under `dir`, not following links or going into hidden or build folders. */
async function walkDocs(dir: string): Promise<string[]> {
  const out: string[] = [];
  const queue: [string, number][] = [['', 0]];
  while (queue.length && out.length <= MAX_DOCS) {
    const [rel, depth] = queue.shift()!;
    let entries;
    try {
      entries = await readdir(path.join(dir, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) queue.push([p, depth + 1]);
      } else if (e.isFile() && isDocPath(p)) out.push(p);
    }
  }
  return out;
}

/**
 * What a doc calls itself, from its first few KB: a `title:` in its front matter, else its first
 * heading (# Title, Title over ===, or an HTML <h1> as some READMEs have).
 */
export function docTitle(head: string): string | undefined {
  let text = head.replace(/^﻿/, '');
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (front) {
    const t = /^title:\s*["']?(.+?)["']?\s*$/m.exec(front[1]);
    if (t) return clean(t[1]);
    text = text.slice(front[0].length);
  }
  let fenced = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const atx = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (atx) return clean(atx[1]);
    const html = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/i.exec(line);
    if (html && clean(html[1])) return clean(html[1]);
    if (line.trim() && /^ {0,3}(=+|-+)\s*$/.test(lines[i + 1] ?? '') && !/^\s*[-*+>|]/.test(line)) return clean(line);
  }
  return undefined;
}

/** A heading's words without markup: tags, images, link targets, emphasis and code ticks. */
function clean(s: string): string | undefined {
  const t = s
    .replace(/<[^>]*>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t ? t.slice(0, 120) : undefined;
}

async function head(file: string): Promise<string> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

/** A floor's bookshelf: its project's Markdown files, and what's in them. */
export class Docs {
  private last: { at: number; list: DocList } | null = null;
  private listing: Promise<DocList> | null = null;
  /** Titles by path, kept while the file's size and time stay the same. */
  private titles = new Map<string, { sig: string; title?: string }>();

  constructor(private dir: string) {}

  /** Every Markdown file in the project, by path. */
  list(): Promise<DocList> {
    if (this.last && Date.now() - this.last.at < FRESH_MS) return Promise.resolve(this.last.list);
    this.listing ??= this.scan().finally(() => (this.listing = null));
    return this.listing;
  }

  private async scan(): Promise<DocList> {
    const found = ((await gitDocs(this.dir)) ?? (await walkDocs(this.dir))).filter(isDocPath).map((p) => p.split(path.sep).join('/'));
    found.sort((a, b) => a.localeCompare(b));
    const more = found.length > MAX_DOCS;
    const files: DocFile[] = [];
    const titles = new Map<string, { sig: string; title?: string }>();
    // A few at a time: a big project has thousands.
    const paths = found.slice(0, MAX_DOCS);
    for (let i = 0; i < paths.length; i += 32) {
      const batch = await Promise.all(
        paths.slice(i, i + 32).map(async (p): Promise<DocFile | undefined> => {
          try {
            const abs = path.join(this.dir, p);
            const s = await stat(abs);
            // Tracked but deleted, or a folder called something.md.
            if (!s.isFile()) return undefined;
            const sig = `${s.size}:${Math.round(s.mtimeMs)}`;
            let known = this.titles.get(p);
            if (known?.sig !== sig) known = { sig, title: docTitle(await head(abs)) };
            titles.set(p, known);
            return { path: p, title: known.title, size: s.size, mtime: Math.round(s.mtimeMs) };
          } catch {
            return undefined;
          }
        }),
      );
      for (const f of batch) if (f) files.push(f);
    }
    this.titles = titles;
    const list = { files, more };
    this.last = { at: Date.now(), list };
    return list;
  }

  /** One doc's Markdown. Only Markdown, and only inside the project (not through a link out of it). */
  async read(file: string): Promise<DocText | Failure> {
    if (!isDocPath(file)) return { status: 415, error: 'Only Markdown files are on the bookshelf' };
    const abs = await insideCheckout(this.dir, file);
    if (!abs) return { status: 404, error: 'That file is not in the project' };
    try {
      const s = await stat(abs);
      if (!s.isFile()) return { status: 404, error: 'That is not a file' };
      if (s.size > MAX_DOC_BYTES) return { status: 413, error: `That file is over ${MAX_DOC_BYTES / 1024 / 1024} MB` };
      return { path: file, text: await readFile(abs, 'utf8') };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 404, error: 'That file is gone' };
      return { status: 500, error: (err as Error).message };
    }
  }

  /** A picture a doc shows, from the project. */
  async picture(file: string): Promise<ImageResult> {
    const type = changedImageType(file);
    if (!type) return { status: 415, error: 'Only pictures' };
    const abs = await insideCheckout(this.dir, file);
    if (!abs) return { status: 404, error: 'That file is not in the project' };
    try {
      const s = await stat(abs);
      if (!s.isFile()) return { status: 404, error: 'That is not a file' };
      if (s.size > MAX_PICTURE_BYTES) return { status: 413, error: `That picture is over ${MAX_PICTURE_BYTES / 1024 / 1024} MB` };
      return { type, body: await readFile(abs) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 404, error: 'That file is gone' };
      return { status: 500, error: (err as Error).message };
    }
  }
}
