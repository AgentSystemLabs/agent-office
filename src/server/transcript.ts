// A worker's chat, read off Claude Code's session transcript: the JSONL file its hooks name (see
// providers/claude.ts), tailed as it grows. Each `user` and `assistant` record becomes chat items:
// a prompt, what the agent said, and each tool it used, with the tool's result filled in once the
// `tool_result` for it is written. The file's format belongs to Claude Code, so everything here is
// parsed defensively and anything unrecognised is skipped.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import type { ChatItem } from '../shared/protocol.js';

/** The most items kept per worker; older ones are forgotten (the terminal's scrollback has them). */
const MAX_ITEMS = 3000;
/** How much of a tool's input and result go to the browser. */
const INPUT_MAX = 600;
const RESULT_MAX = 2000;
const CHUNK = 4 * 1024 * 1024;

/** Cut to `max` characters, with a mark where it was cut. */
function cut(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} more characters)` : s;
}

/** The text of a content block, or of a tool result's content, which can be text blocks or a string. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : b && (b as { type?: unknown }).type === 'image' ? '[image]' : ''))
    .filter(Boolean)
    .join('\n');
}

/**
 * What a person typed, as they typed it: Claude Code wraps slash commands and what the office or a
 * hook adds in tags of its own, which aren't the conversation.
 */
export function cleanPrompt(text: string): string {
  const command = /<command-name>([^<]*)<\/command-name>/.exec(text)?.[1]?.trim();
  const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1]?.trim();
  if (command) return args ? `${command} ${args}` : command;
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
    .replace(/<\/?[a-z_-]+>/g, '')
    .trim();
}

/** The gist of a tool's input: the one field that says what it did, or else the whole thing. */
export function toolGist(name: string, input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const first = (...keys: string[]) => keys.map((k) => i[k]).find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  const gist = first('command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'description', 'prompt', 'skill', 'path') ?? (Object.keys(i).length ? JSON.stringify(i) : '');
  return cut(gist, INPUT_MAX);
}

/**
 * Turns a worker's transcript into chat items as the file grows. `read()` takes in what's new and
 * says which items were added and which already-sent ones changed (a tool's result came back).
 */
export class TranscriptLog {
  readonly items: ChatItem[] = [];
  private offset = 0;
  private rest = '';
  /** Each tool call still waiting for its result, by the tool_use id its result will name. */
  private pending = new Map<string, ChatItem>();

  constructor(readonly path: string) {}

  /** Reads what's been written since last time. Nothing happens if the file can't be read yet. */
  read(): { added: ChatItem[]; patched: ChatItem[] } {
    const added: ChatItem[] = [];
    const patched: ChatItem[] = [];
    for (const line of this.newLines()) this.take(line, added, patched);
    if (this.items.length > MAX_ITEMS) this.items.splice(0, this.items.length - MAX_ITEMS);
    return { added, patched };
  }

  /** One record of the transcript. */
  take(line: string, added: ChatItem[], patched: ChatItem[]) {
    let r: any;
    try {
      r = JSON.parse(line);
    } catch {
      return;
    }
    if (!r || typeof r !== 'object' || r.isSidechain || r.isMeta || r.isCompactSummary) return;
    const at = Date.parse(r.timestamp) || Date.now();
    const id = typeof r.uuid === 'string' ? r.uuid : `${at}-${this.items.length}`;
    const content = r.message?.content;
    if (r.type === 'user') {
      if (typeof content === 'string') return this.push(added, { id, at, role: 'you', text: cleanPrompt(content) });
      if (!Array.isArray(content)) return;
      let n = 0;
      for (const b of content) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'tool_result') {
          const item = typeof b.tool_use_id === 'string' ? this.pending.get(b.tool_use_id) : undefined;
          if (!item?.tool) continue;
          this.pending.delete(b.tool_use_id);
          item.tool.result = cut(textOf(b.content), RESULT_MAX);
          if (b.is_error) item.tool.error = true;
          // Already in `added` when the call and its result come in the same read: don't send it twice.
          if (!added.includes(item)) patched.push(item);
        } else if (b.type === 'text' && typeof b.text === 'string') {
          const text = cleanPrompt(b.text);
          if (!text) continue;
          const interrupted = /^\[Request interrupted by user/i.test(text);
          this.push(added, { id: `${id}-${n++}`, at, role: interrupted ? 'note' : 'you', text: interrupted ? 'Interrupted' : text });
        }
      }
    } else if (r.type === 'assistant' && Array.isArray(content)) {
      let n = 0;
      for (const b of content) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) this.push(added, { id: `${id}-${n++}`, at, role: 'agent', text: b.text });
        else if (b.type === 'tool_use' && typeof b.name === 'string') {
          const item: ChatItem = { id: typeof b.id === 'string' ? b.id : `${id}-${n++}`, at, role: 'tool', tool: { name: b.name, input: toolGist(b.name, b.input) } };
          if (typeof b.id === 'string') this.pending.set(b.id, item);
          this.push(added, item);
        }
      }
    }
  }

  private push(added: ChatItem[], item: ChatItem) {
    this.items.push(item);
    added.push(item);
  }

  /** Whole lines written since the last read; a half-written last line waits for the rest. */
  private *newLines(): Generator<string> {
    let fd: number;
    try {
      fd = openSync(this.path, 'r');
    } catch {
      return;
    }
    try {
      const size = fstatSync(fd).size;
      // Started over (a shorter file): read it from the top.
      if (size < this.offset) {
        this.offset = 0;
        this.rest = '';
      }
      const buf = Buffer.allocUnsafe(CHUNK);
      while (this.offset < size) {
        const n = readSync(fd, buf, 0, Math.min(CHUNK, size - this.offset), this.offset);
        if (n <= 0) break;
        this.offset += n;
        const text = this.rest + buf.toString('utf8', 0, n);
        const lines = text.split('\n');
        this.rest = lines.pop() ?? '';
        for (const l of lines) if (l.trim()) yield l;
      }
    } finally {
      closeSync(fd);
    }
  }
}
