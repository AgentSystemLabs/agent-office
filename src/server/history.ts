import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type headless from '@xterm/headless';
import type serialize from '@xterm/addon-serialize';
import type { ChatLine } from '../shared/protocol.js';
import { logicalLines, searchKey, snippet } from '../shared/search.js';

type HeadlessTerminal = InstanceType<typeof headless.Terminal>;
type Serializer = InstanceType<typeof serialize.SerializeAddon>;

/** How many chat lines the office keeps, across restarts. */
export const CHAT_KEEP = 1000;

/** The office chat, kept in .agent-office/chat.jsonl (a line per message) so a restart doesn't wipe it. */
export class ChatLog {
  private lines: ChatLine[] = [];
  private file: string;
  /** Lines in the file. It only grows between rewrites, which trim it back to CHAT_KEEP. */
  private fileLines = 0;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'chat.jsonl');
    this.load();
  }

  recent(n: number): ChatLine[] {
    return this.lines.slice(-n);
  }

  add(line: ChatLine) {
    this.lines.push(line);
    if (this.lines.length > CHAT_KEEP) this.lines.splice(0, this.lines.length - CHAT_KEEP);
    if (this.fileLines >= CHAT_KEEP * 2) return this.rewrite();
    try {
      appendFileSync(this.file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
      this.fileLines++;
    } catch {
      // disk issues shouldn't take the office down
    }
  }

  /** Lines whose text or sender holds `needle` (a searchKey), newest first. */
  search(needle: string, limit: number): { hits: ChatLine[]; more: boolean } {
    const hits: ChatLine[] = [];
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      if (!searchKey(`${l.name}: ${l.text}`).includes(needle)) continue;
      if (hits.length === limit) return { hits, more: true };
      hits.push(l);
    }
    return { hits, more: false };
  }

  private load() {
    if (!existsSync(this.file)) return;
    let raw: string[];
    try {
      raw = readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
    } catch {
      return;
    }
    for (const s of raw) {
      try {
        const l = JSON.parse(s) as Partial<ChatLine>;
        if (typeof l.text !== 'string' || typeof l.name !== 'string' || typeof l.at !== 'number') continue;
        this.lines.push({ from: typeof l.from === 'string' ? l.from : '', name: l.name, color: typeof l.color === 'string' ? l.color : '#4f86f7', text: l.text, at: l.at, ...(l.account === true ? { account: true } : {}) });
      } catch {
        // a torn last line (the office died mid-write) is skipped
      }
    }
    this.fileLines = raw.length;
    if (this.lines.length > CHAT_KEEP || this.lines.length !== raw.length) {
      this.lines = this.lines.slice(-CHAT_KEEP);
      this.rewrite();
    }
  }

  private rewrite() {
    try {
      writeFileSync(this.file, this.lines.map((l) => `${JSON.stringify(l)}\n`).join(''), { mode: 0o600 });
      this.fileLines = this.lines.length;
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}

/** Each worker's latest terminal output, kept in .agent-office/scrollback/<worker id>.ansi across restarts. */
export class ScrollbackStore {
  private dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'scrollback');
  }

  save(workerId: string, data: string) {
    const file = this.file(workerId);
    if (!file) return;
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      if (data) writeFileSync(file, data, { mode: 0o600 });
      else rmSync(file, { force: true });
    } catch {
      // disk issues shouldn't take the office down
    }
  }

  load(workerId: string): string | undefined {
    const file = this.file(workerId);
    try {
      return file && existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    } catch {
      return undefined;
    }
  }

  remove(workerId: string) {
    const file = this.file(workerId);
    try {
      if (file) rmSync(file, { force: true });
    } catch {
      // already gone
    }
  }

  /** Deletes what's kept for workers that are no longer at a desk. */
  prune(keep: Set<string>) {
    try {
      for (const f of readdirSync(this.dir)) {
        if (f.endsWith('.ansi') && !keep.has(f.slice(0, -'.ansi'.length))) rmSync(path.join(this.dir, f), { force: true });
      }
    } catch {
      // no folder yet
    }
  }

  private file(workerId: string): string | undefined {
    return /^[\w-]{1,64}$/.test(workerId) ? path.join(this.dir, `${workerId}.ansi`) : undefined;
  }
}

/**
 * A terminal's last `maxLines` lines as escape codes that redraw them, colors and all, ending with
 * the cursor just after the last one. A full-screen program's screen (the alternate buffer) is
 * added as plain text, since it is not part of the scrollback.
 */
export function terminalTail(term: HeadlessTerminal, ser: Serializer, maxLines: number): string {
  const buf = term.buffer.normal;
  let last = buf.length - 1;
  while (last >= 0 && !buf.getLine(last)?.translateToString(true)) last--;
  let out = '';
  if (last >= 0) {
    let start = Math.max(0, last - maxLines + 1);
    // Don't start halfway through a line the terminal wrapped.
    while (start > 0 && buf.getLine(start)?.isWrapped) start--;
    out = `${ser.serialize({ range: { start, end: last }, excludeAltBuffer: true, excludeModes: true })}\x1b[0m`;
  }
  if (term.buffer.active.type === 'alternate') {
    const screen = logicalLines(term.buffer.alternate).map((l) => l.text.trimEnd());
    while (screen.length && !screen[screen.length - 1]) screen.pop();
    if (screen.length) out += `${out ? '\r\n' : ''}${screen.join('\r\n')}`;
  }
  return out;
}

/**
 * The lines of a worker's terminal holding `needle` (a searchKey), newest first, one per distinct
 * line: a full-screen program's screen first, then the scrollback.
 */
export function searchTerminal(term: HeadlessTerminal, needle: string, limit: number): { hits: { text: string; row: number; rows: number }[]; more: boolean } {
  const buffers = term.buffer.active.type === 'alternate' ? [term.buffer.alternate, term.buffer.normal] : [term.buffer.normal];
  const seen = new Set<string>();
  const hits: { text: string; row: number; rows: number }[] = [];
  for (const buf of buffers) {
    const lines = logicalLines(buf);
    for (let i = lines.length - 1; i >= 0; i--) {
      const key = searchKey(lines[i].text);
      // A TUI redraws the same line over and over (a status bar, a prompt box): show it once.
      if (!key.includes(needle) || seen.has(key)) continue;
      if (hits.length === limit) return { hits, more: true };
      seen.add(key);
      hits.push({ text: snippet(lines[i].text, needle), row: lines[i].row, rows: buf.length });
    }
  }
  return { hits, more: false };
}
