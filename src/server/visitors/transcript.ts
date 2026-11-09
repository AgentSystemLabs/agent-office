// Reading a Claude Code session's transcript for the visitors: its first and last few hundred
// kilobytes (they run to tens of megabytes), opened read-only and never written to.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import type { VisitorApp, VisitorStatus } from '../../shared/protocol.js';
import { truncate } from '../workers/util.js';

/** A slice of `file`: its first or last `bytes`, and whether that's all of it. '' when it can't be read. */
export function readSlice(file: string, from: 'head' | 'tail', bytes: number): { text: string; whole: boolean } {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, from === 'head' ? 0 : size - len);
    return { text: buf.toString('utf8'), whole: len === size };
  } catch {
    return { text: '', whole: true };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The JSON entries in a slice, oldest first: whole lines only (a slice can start or end mid-line). */
export function entries(slice: { text: string; whole: boolean }, from: 'head' | 'tail'): any[] {
  const lines = slice.text.split('\n');
  if (!slice.whole) {
    if (from === 'tail') lines.shift();
    else lines.pop();
  }
  const out: any[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === 'object') out.push(e);
    } catch {
      // a line cut short, or not JSON: skipped
    }
  }
  return out;
}

/** What the app that wrote it calls itself (`entrypoint`), as the visitor's sign says it. */
export function appOf(entrypoint: unknown): VisitorApp {
  if (typeof entrypoint !== 'string') return 'other';
  if (entrypoint === 'claude-desktop') return 'desktop';
  if (entrypoint === 'cli') return 'cli';
  if (/vscode|jetbrains|ide|cursor|zed/i.test(entrypoint)) return 'ide';
  return 'other';
}

/** One line of what a tool call is about: "Bash: npm test". */
export function describeToolUse(block: any): string {
  // An MCP server's tool (mcp__<server>__<tool>) goes by the tool's own name.
  const name = typeof block?.name === 'string' ? block.name.replace(/^mcp__.+?__/, '') : 'tool';
  const input = block?.input ?? {};
  const detail = input.description ?? input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.query ?? input.prompt ?? '';
  return truncate(typeof detail === 'string' && detail ? `${name}: ${detail.replace(/\s+/g, ' ')}` : name, 80);
}

/** The text of a message's content: a string, or its text blocks. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join(' ');
}

/** Tools that wait on the person at the keyboard, not on the model. */
const ASKS = new Set(['AskUserQuestion', 'ExitPlanMode']);

/** What the last turn of a session says about it, from the tail of its transcript (oldest entry first). */
export interface TurnFacts {
  status: VisitorStatus;
  activity?: string;
  model?: string;
  /** Whether a message was found at all: a tail of one huge line has none, and is read again bigger. */
  found: boolean;
}

/**
 * How a session is getting on, from its latest messages. `sidechain`: it's a subagent's transcript,
 * every entry of which is marked as off the main thread.
 */
export function turnOf(tail: any[], sidechain = false): TurnFacts {
  let model: string | undefined;
  /** A tool's result came last: it's at work, on whatever the call before it was. */
  let resulted = false;
  for (let i = tail.length - 1; i >= 0; i--) {
    const e = tail[i];
    if ((e.isSidechain && !sidechain) || e.isMeta) continue;
    const m = e.message;
    if (e.type === 'assistant' && m && typeof m === 'object') {
      if (!model && typeof m.model === 'string' && !m.model.startsWith('<')) model = m.model;
      const content = Array.isArray(m.content) ? m.content : [];
      const tools = content.filter((b: any) => b?.type === 'tool_use');
      const last = tools[tools.length - 1];
      if (resulted) return { status: 'working', activity: last ? describeToolUse(last) : undefined, model, found: true };
      if (m.stop_reason === 'tool_use' || (last && !m.stop_reason)) {
        return { status: last && ASKS.has(last.name) ? 'needs_input' : 'working', activity: last ? describeToolUse(last) : undefined, model, found: true };
      }
      if (!m.stop_reason) return { status: 'working', model, found: true };
      const said = textOf(m.content).replace(/\s+/g, ' ').trim();
      return { status: 'done', activity: said ? truncate(said, 80) : undefined, model, found: true };
    }
    if (e.type === 'user' && m && typeof m === 'object' && !resulted) {
      const content = m.content;
      if (Array.isArray(content) && content.some((b: any) => b?.type === 'tool_result')) {
        resulted = true;
        continue;
      }
      // Esc: the turn was stopped, and it waits for the next prompt.
      if (/^\[Request interrupted/.test(textOf(content).trim())) return { status: 'done', model, found: true };
      return { status: 'working', model, found: true };
    }
  }
  return { status: resulted ? 'working' : 'done', model, found: resulted };
}

/** What the head and tail of a transcript say about the session as a whole. */
export interface SessionFacts {
  /** Its name in the app (/rename, the desktop app's title), the latest given. */
  title?: string;
  /** Its first prompt, for one without a name. */
  prompt?: string;
  cwd?: string;
  branch?: string;
  app: VisitorApp;
}

/** A prompt worth calling the session by: a person's, not a command's or a reminder's. */
function promptOf(e: any): string | undefined {
  if (e.type !== 'user' || e.isMeta || e.isSidechain || e.origin?.kind === 'task-notification') return undefined;
  const text = textOf(e.message?.content).replace(/\s+/g, ' ').trim();
  if (!text || text.startsWith('<') || text.startsWith('[Request interrupted')) return undefined;
  return truncate(text, 70);
}

export function sessionOf(head: any[], tail: any[]): SessionFacts {
  const facts: SessionFacts = { app: 'other' };
  const named = (e: any) => (e.type === 'custom-title' ? e.customTitle : e.type === 'agent-name' ? e.agentName : e.type === 'summary' ? e.summary : undefined);
  for (const list of [tail, head]) {
    for (let i = list.length - 1; i >= 0 && !facts.title; i--) {
      const t = named(list[i]);
      if (typeof t === 'string' && t.trim()) facts.title = truncate(t.trim(), 70);
    }
  }
  for (const e of head) {
    facts.prompt ??= promptOf(e);
    if (typeof e.entrypoint === 'string' && facts.app === 'other') facts.app = appOf(e.entrypoint);
    if (typeof e.cwd === 'string') facts.cwd ??= e.cwd;
  }
  for (let i = tail.length - 1; i >= 0; i--) {
    const e = tail[i];
    if (typeof e.cwd === 'string' && !facts.cwd) facts.cwd = e.cwd;
    // A detached checkout says HEAD, which names no branch.
    if (typeof e.gitBranch === 'string' && e.gitBranch && e.gitBranch !== 'HEAD' && !facts.branch) facts.branch = e.gitBranch;
    if (facts.app === 'other' && typeof e.entrypoint === 'string') facts.app = appOf(e.entrypoint);
    if (facts.cwd && facts.branch && facts.app !== 'other') break;
  }
  return facts;
}
