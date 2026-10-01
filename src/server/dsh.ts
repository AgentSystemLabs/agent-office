// DeepSeek Harness as a fourth provider, over ACP (see docs/dsh-acp-integration.md).
//
// `dsh` has no interactive terminal: its ACP profile speaks newline-delimited JSON-RPC v1 over
// stdio instead. A DSH worker therefore keeps the office's headless terminal, but nothing is
// mirrored into it — committed assistant messages, thoughts, tool lifecycles and permission
// prompts are rendered into it here, as ANSI lines.
//
// This module owns the wire. The translation core above the connection is pure, so the test suite
// can drive a fake ACP agent over stdio without a DSH install (tests/dsh.test.ts).

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { commandAction, toolAction } from '../shared/actions.js';
import type { AgentEffort, Usage, WorkerAction, WorkerStatus } from '../shared/protocol.js';

export const DSH_PROFILE_DEFAULT = 'acp';
/** Where a floor keeps the sessions the office lists and resumes (under its .agent-office dir). */
export const DSH_SESSIONS_DIR = 'dsh-sessions';
export const DSH_PATCH_FILE = 'dsh-patch.yml';

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const DIM = `${ESC}2m`;
const BOLD = `${ESC}1m`;
const ITALIC = `${ESC}3m`;
const UNDERLINE = `${ESC}4m`;

/** 24-bit foreground, for the harness's own semantic colors on the office's dark terminal. */
function fg(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return `${ESC}38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
}

/** 24-bit background, for the harness's code blocks. */
function bg(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return `${ESC}48;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
}

/**
 * DeepSeek Harness's own design tokens, read off its theme (`body[data-ds-dark-theme]`, the mode
 * the office's dark terminal matches) and carried into ANSI here. Every color in this file comes
 * from this table, so the transcript and the harness's web chat agree.
 */
const V = {
  /** `label-primary`: assistant prose. */
  text: fg('#F9FAFB'),
  /** `label-secondary`: a tool's title. */
  secondary: fg('#CFD3D6'),
  /** `label-tertiary`: reasoning, tool summaries, captions. */
  muted: fg('#ADB2B8'),
  /** `label-caption`: the dot between a tool's title and its summary. */
  faint: fg('#81858C'),
  /** `link` (dark): the harness's blue, for notices and the person's own line. */
  brand: fg('#7AAAFF'),
  /** `state-success-primary`. */
  ok: fg('#22C55E'),
  /** `state-warn-primary`, with `-secondary` for the approval edge. */
  warn: fg('#F59E0B'),
  warnEdge: fg('#F7AD31'),
  /** `state-error-primary` (dark). */
  bad: fg('#F25A5A'),
  /** Code: the harness renders it in the body color on a subtle block of its own. */
  code: fg('#E1E5EE'),
  inlineCodeBg: bg('#292929'),
  blockCodeBg: bg('#1B1B1C'),
  /** `label-dimmed`, for a fenced block's gutter. */
  faintBg: fg('#81858C'),
  reset: RESET,
  bold: BOLD,
  italic: ITALIC,
  underline: UNDERLINE,
  dim: DIM,
} as const;

/** The left rule that marks a block as reasoning rather than the answer. */
const THOUGHT_RULE = '│';
/** The marker a tool call's outcome hangs from. */
const TOOL_ELBOW = '└';

/** Bounds on everything read off the wire, so a chatty or hostile agent can't grow a terminal. */
const MAX_TEXT = 4000;
const MAX_LINE = 2000;
const MAX_FRAME = 4_000_000;
/** A line typed into a DSH terminal, before Enter: about what a prompt box takes. */
const MAX_TYPED = 20_000;
/** A permission request never needs more choices than a person can read. */
const MAX_OPTIONS = 20;
const CONTROL_TIMEOUT_MS = 30_000;
/** Tool output shown per update: enough to be useful, not enough to bury the turn. */
const MAX_TOOL_OUTPUT_LINES = 8;

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function bounded(text: string, max = MAX_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function oneLine(text: string, max = MAX_LINE): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// The wire, as far as this office needs it
// ---------------------------------------------------------------------------

export interface DshPermissionOption {
  optionId: string;
  name: string;
  kind: string;
  /** One-shot choices are the only ones ACP offers; kept for the rendered prompt. */
  once: boolean;
}

/** The choices a permission request offers, defensively read off the wire. */
export function permissionOptions(params: unknown): DshPermissionOption[] {
  const raw = isRec(params) && Array.isArray(params.options) ? params.options : [];
  const options: DshPermissionOption[] = [];
  for (const entry of raw) {
    if (options.length >= MAX_OPTIONS) break;
    if (!isRec(entry)) continue;
    const optionId = str(entry.optionId);
    if (!optionId) continue;
    const kind = str(entry.kind) ?? 'other';
    options.push({ optionId, name: oneLine(str(entry.name) ?? optionId, 120), kind, once: kind.includes('once') });
  }
  return options;
}

/** What a typed line means while a permission prompt is open: an option, or nothing. */
export function permissionChoice(line: string, options: DshPermissionOption[]): DshPermissionOption | undefined {
  const text = line.trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return options[Number(text) - 1];
  return options.find((o) => o.optionId === text) ?? options.find((o) => o.name.toLowerCase() === text.toLowerCase());
}

/** A one-line notice from the office itself, rather than from the model. */
function notice(kind: 'info' | 'warn' | 'bad' | 'quiet', text: string): string {
  const glyph = kind === 'bad' ? '✖' : kind === 'warn' ? '▲' : kind === 'quiet' ? '·' : '◆';
  const paint = kind === 'bad' ? V.bad : kind === 'warn' ? V.warn : kind === 'quiet' ? V.muted : V.brand;
  const body = kind === 'quiet' ? V.muted : paint;
  return `${paint}${glyph}${V.reset} ${body}${escapeText(text)}${V.reset}\r\n`;
}

/**
 * The prompted lines for an outstanding permission request. `remembered` is what the tool call's own
 * row said it would do (see DshRenderer.toolDetail), for a request that carries only the call's id.
 */
export function renderPermission(params: unknown, options: DshPermissionOption[], remembered?: string): string {
  const toolCall = isRec(params) && isRec(params.toolCall) ? params.toolCall : {};
  // The approval card names the tool the way the harness does, and shows what it will run under it,
  // in full: what is being approved must never be cut off or left to the model's own description.
  const label = str(toolCall.title) ?? str(toolCall.name);
  const detail = (isRec(toolCall.rawInput) ? toolSummary(toolCall.rawInput, DETAIL_KEYS) : undefined) ?? remembered;
  const what = label ? oneLine(label, 120) : undefined;
  const lines = [
    `\r\n${V.warn}${BOLD}  ▲ Waiting for approval${V.reset} ${V.secondary}${what ? `Tool ${escapeText(what)} requests privileged execution` : 'A tool call requests privileged execution'}${V.reset}\r\n`,
  ];
  if (detail && detail !== label) lines.push(`    ${V.code}${escapeText(oneLine(detail, MAX_TEXT))}${V.reset}\r\n`);
  const width = options.reduce((max, option) => Math.max(max, option.name.length), 0);
  options.forEach((option, index) => {
    // The card paints reject in the error color and allow in the warning's own; so does this.
    const paint = /reject|cancel|deny/.test(option.kind) ? V.bad : V.warnEdge;
    lines.push(`  ${paint}${BOLD}${index + 1}${V.reset}${V.faint})${V.reset} ${V.secondary}${escapeText(option.name.padEnd(width))}${V.reset}  ${V.faint}${escapeText(option.kind)}${V.reset}\r\n`);
  });
  const hint = allowOption(options) ? 'Enter allows once, Esc rejects, or type a number for another choice.' : 'Type a number to choose, or Esc to reject.';
  lines.push(`  ${V.muted}${hint}${V.reset}\r\n`);
  return lines.join('');
}

/**
 * The choice the harness's Enter key means: allow once, and only that. A request with no one-shot
 * allow (only "always", say) needs a number typed, so a stray Enter never grants more than one call.
 */
function allowOption(options: DshPermissionOption[]): DshPermissionOption | undefined {
  return options.find((option) => option.once && /allow|approve|accept/.test(option.kind));
}

/** What a tool call will act on, most specific first: the approval card shows this, not the model's description of it. */
const DETAIL_KEYS = ['command', 'path', 'file_path', 'query', 'pattern', 'url', 'description'];

/** The choice its Escape key means: reject, if the tool offers one. */
function rejectOption(options: DshPermissionOption[]): DshPermissionOption | undefined {
  return options.find((option) => /reject|cancel|deny/.test(option.kind));
}

/**
 * The ACP `ToolKind` → office action mapping (docs/dsh-acp-integration.md). Kinds are semantic, so
 * they are trusted ahead of the tool's name; a call with no usable kind falls back to the same
 * name-based mapper the other providers use.
 */
export function toolKindAction(kind: unknown, name: unknown, title: unknown, rawInput: unknown): WorkerAction | undefined {
  const k = str(kind);
  if (k === 'read') return 'read';
  if (k === 'edit' || k === 'delete' || k === 'move') return 'edit';
  if (k === 'fetch') return 'web';
  if (k === 'execute') {
    const command = isRec(rawInput) ? str(rawInput.command) : undefined;
    return command ? commandAction(command) : undefined;
  }
  if (k === 'search') {
    // A code search reads; a web search browses. The title is where the difference shows.
    const haystack = `${str(title) ?? ''} ${str(name) ?? ''}`.toLowerCase();
    return /web|fetch|http|url|brows/.test(haystack) ? 'web' : 'read';
  }
  if (!k) return toolAction(name ?? title, rawInput);
  return undefined; // think, switch_mode, other: plain typing
}

/**
 * ACP's `usage_update` is context occupancy plus, possibly, a cumulative cost — not the
 * input/output/cache split the office's Usage type wants. Context tokens are reported as `input`
 * with an authoritative `totalTokens`, and cost is only shown when the agent supplies it
 * (docs/dsh-acp-integration.md, usage option 1).
 */
export function dshUsage(update: unknown): Usage | undefined {
  if (!isRec(update)) return undefined;
  const used = num(update.used);
  const size = num(update.size);
  if (used === undefined || size === undefined) return undefined;
  const cost = isRec(update.cost) ? num(update.cost.amount) : undefined;
  return {
    input: Math.max(0, Math.round(used)),
    output: 0,
    reasoning: 0,
    cacheWrite: 0,
    cacheRead: 0,
    cost: cost !== undefined ? Math.max(0, cost) : 0,
    costKnown: cost !== undefined,
    calls: 0,
    callsKnown: false,
    totalTokens: Math.max(0, Math.round(used)),
    contextSize: Math.max(0, Math.round(size)),
  };
}

export interface RenderedUpdate {
  /** ANSI text for the worker's terminal (empty when the update is not worth a line). */
  text: string;
  /** What the worker should act out now. */
  action?: WorkerAction;
  /** A tool call that failed, for the hands-on-heads pose. */
  failed?: boolean;
  /** Context usage, when the update carried any. */
  usage?: Usage;
}

/**
 * Renders committed ACP updates into terminal lines, in the harness's own visual language.
 *
 * Text is buffered by line rather than written as it streams: a line is emitted only once it is
 * complete, so markdown is formatted whole, a span never splits across chunks, and every line ends
 * CRLF (a bare LF drifting the cursor is what made the first version's output staircase). Reasoning
 * is the harness's "Think" block, each tool call is one row with the harness's own title and
 * summary, a finished tool call is left collapsed the way the chat leaves it, and an approval reads
 * like its approval card. Anything the office does not understand is skipped, never fatal.
 */
export class DshRenderer {
  private mode: 'text' | 'thought' | undefined;
  private buffer = '';
  private fence = false;
  /** Tool calls by id, so an update that carries only the id still knows what the tool was. */
  private tools = new Map<string, ToolRow>();
  private toolCalls = 0;

  /** What tool call `id` said it would act on, for the approval card. */
  toolDetail(id: string | undefined): string | undefined {
    return id ? this.tools.get(id)?.detail : undefined;
  }

  /**
   * Closes the turn: flush what is left, close an open code fence, and report the turn the way the
   * chat's process row does ("Worked · 3 tool calls").
   */
  endTurn(outcome: 'Worked' | 'Stopped' | 'Failed' = 'Worked'): string {
    const out: string[] = [];
    this.flush(out, true);
    this.closeFence(out);
    this.mode = undefined;
    const calls = this.toolCalls;
    this.toolCalls = 0;
    const paint = outcome === 'Failed' ? V.bad : outcome === 'Stopped' ? V.warn : V.muted;
    const count = calls ? ` · ${calls} tool call${calls === 1 ? '' : 's'}` : '';
    out.push(`${paint}  ${outcome}${count}${V.reset}\r\n`);
    return out.join('');
  }

  render(update: unknown): RenderedUpdate {
    const out: string[] = [];
    if (!isRec(update)) return { text: '' };
    const kind = str(update.sessionUpdate);

    if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
      const text = isRec(update.content) ? str(update.content.text) : undefined;
      if (!text) return { text: '' };
      this.write(out, kind === 'agent_thought_chunk' ? 'thought' : 'text', text);
      return { text: out.join('') };
    }

    if (kind === 'tool_call') {
      this.closeFence(out);
      this.flush(out, true);
      const id = str(update.toolCallId);
      const row = toolRow(update);
      if (id) this.tools.set(id, row);
      this.toolCalls++;
      out.push(toolLine(row));
      return { text: out.join(''), action: toolKindAction(update.kind, update.name, update.title, update.rawInput) };
    }

    if (kind === 'tool_call_update') {
      const id = str(update.toolCallId);
      const remembered = id ? this.tools.get(id) : undefined;
      const row = toolRow(update, remembered);
      if (id) this.tools.set(id, row);
      const status = str(update.status);
      if (status === 'failed') {
        this.closeFence(out);
        this.flush(out, true);
        const why = toolError(update);
        out.push(`  ${V.faint}${TOOL_ELBOW}${V.reset} ${V.bad}${escapeText(row.title)} failed${V.reset}${why ? ` ${V.faint}·${V.reset} ${V.muted}${escapeText(why)}${V.reset}` : ''}\r\n`);
        out.push(...this.toolOutput(update));
        return { text: out.join(''), action: 'failing', failed: true };
      }
      // completed: the harness leaves a finished tool call collapsed, with no check mark, so there
      // is nothing to add to the row this tool already printed.
      const action = toolKindAction(update.kind, update.name, update.title, update.rawInput);
      return action ? { text: '', action } : { text: '' };
    }

    if (kind === 'usage_update') return { text: '', usage: dshUsage(update) };

    if (kind === 'config_option_update') {
      this.closeFence(out);
      this.flush(out, true);
      for (const option of Array.isArray(update.configOptions) ? update.configOptions : []) {
        if (!isRec(option)) continue;
        const id = str(option.id);
        const value = str(option.currentValue) ?? (typeof option.currentValue === 'boolean' ? String(option.currentValue) : undefined);
        if (id && value) out.push(`  ${V.muted}${escapeText(id)} ${V.faint}→${V.reset} ${V.muted}${escapeText(oneLine(value, 120))}${V.reset}\r\n`);
      }
      return { text: out.join('') };
    }

    // plan, current_mode, available_commands and anything newer: not part of this surface.
    return { text: '' };
  }

  /** Buffers streamed text for `mode`, flushing whole lines as they complete. */
  private write(out: string[], mode: 'text' | 'thought', text: string): void {
    if (this.mode !== mode) {
      const wasThinking = this.mode === 'thought';
      this.closeFence(out);
      this.flush(out, true);
      this.mode = mode;
      // The chat introduces reasoning with a "Think" row; give the block the same heading, and let
      // the answer start clear of it.
      if (mode === 'thought') out.push(`${V.secondary}  ✻ Think${V.reset}\r\n`);
      else if (wasThinking) out.push('\r\n');
    }
    this.buffer += text;
    this.flush(out, false);
  }

  private flush(out: string[], final: boolean): void {
    // Model text is untrusted: keep newlines and tabs, and strip whole escape sequences (colors,
    // cursor moves, window titles) before anything else looks at the text, so no trace of one can
    // show up as if the model had typed it.
    this.buffer = escapeText(this.buffer.replace(/\r\n?/g, '\n'));
    for (;;) {
      const nl = this.buffer.indexOf('\n');
      if (nl < 0) break;
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      out.push(this.line(line));
    }
    // A single line that never ends still has to show something before it is finished.
    if (this.buffer.length > 4000) {
      out.push(this.line(this.buffer));
      this.buffer = '';
    }
    if (final && this.buffer) {
      out.push(this.line(this.buffer));
      this.buffer = '';
    }
  }

  /** One complete line, styled for what it is: fenced code, reasoning, or the answer. */
  private line(raw: string): string {
    const text = raw.replace(/\t/g, '  ').replace(/\s+$/, '');
    const probe = text.trim();
    if (probe.startsWith('```')) {
      const opening = !this.fence;
      this.fence = opening;
      if (opening) {
        const language = oneLine(probe.slice(3), 40);
        return `  ${V.faintBg}┌─${language ? ` ${V.code}${V.blockCodeBg}${escapeText(language)}` : ''}${V.reset}\r\n`;
      }
      return `  ${V.faintBg}└─${V.reset}\r\n`;
    }
    if (this.fence) return `  ${V.blockCodeBg}${V.code}${escapeText(text)}${V.reset}\r\n`;
    if (this.mode === 'thought') return `${V.muted}  ${THOUGHT_RULE} ${markdown(text, V.muted)}${V.reset}\r\n`;
    return `${markdown(text, V.text)}${V.reset}\r\n`;
  }

  private closeFence(out: string[]): void {
    if (!this.fence) return;
    this.fence = false;
    out.push(`  ${V.faintBg}└─${V.reset}\r\n`);
  }

  /** A failing tool's own output, tail-first, so it says why without burying the turn. */
  private toolOutput(update: Rec): string[] {
    const text = contentText(update);
    if (!text) return [];
    const lines = text.split('\n').map((line) => line.replace(/\s+$/, ''));
    while (lines.length && !lines.at(-1)?.trim()) lines.pop();
    const shown = lines.slice(-MAX_TOOL_OUTPUT_LINES);
    const omitted = lines.length - shown.length;
    const out = shown.map((line) => `      ${V.muted}${escapeText(oneLine(line, MAX_LINE))}${V.reset}\r\n`);
    if (omitted > 0) out.unshift(`      ${V.faint}… ${omitted} more line${omitted === 1 ? '' : 's'}${V.reset}\r\n`);
    return out;
  }
}

/** One tool call as the chat draws it: a leading icon, a title, and a one-line summary. */
interface ToolRow {
  icon: string;
  title: string;
  summary?: string;
  /** What it acts on (the command, the path), for an approval that names only the call's id. */
  detail?: string;
}

/**
 * The harness's own tool rows: it picks a title and which argument to summarize by the tool's wire
 * name (its client has no per-ToolKind icon table), so this mirrors that table as closely as a
 * terminal can. The icons are glyphs standing in for the SVGs the chat draws.
 */
const TOOL_ROWS: { name: RegExp; icon: string; title: string; keys: string[] }[] = [
  { name: /^(pwsh|bash)$/, icon: '❯', title: 'Bash', keys: ['description', 'command'] },
  { name: /^run_code$/, icon: '{ }', title: 'Code', keys: ['description'] },
  { name: /^read_image$/, icon: '▤', title: 'Read image', keys: ['path', 'file_path'] },
  { name: /^read$/, icon: '▤', title: 'Read', keys: ['path', 'file_path', 'url'] },
  { name: /^web_fetch$/, icon: '⇅', title: 'Fetch', keys: ['url'] },
  { name: /^web_search$/, icon: '⌕', title: 'Search', keys: ['query', 'url'] },
  { name: /^grep$/, icon: '⌕', title: 'Grep', keys: ['pattern', 'path'] },
  { name: /^glob$/, icon: '⌕', title: 'Glob', keys: ['pattern', 'path'] },
  { name: /^write$/, icon: '✎', title: 'Write', keys: ['path', 'file_path'] },
  { name: /^edit$/, icon: '✎', title: 'Edit', keys: ['path', 'file_path'] },
];

/** The fallback for a tool this office does not know, from its semantic kind. */
function kindRow(kind: unknown): { icon: string; title: string; keys: string[] } {
  const k = str(kind);
  if (k === 'read') return { icon: '▤', title: 'Read', keys: ['path', 'file_path'] };
  if (k === 'edit' || k === 'delete' || k === 'move') return { icon: '✎', title: 'Edit', keys: ['path', 'file_path'] };
  if (k === 'execute') return { icon: '❯', title: 'Bash', keys: ['description', 'command'] };
  if (k === 'search') return { icon: '⌕', title: 'Search', keys: ['query', 'pattern'] };
  if (k === 'fetch') return { icon: '⇅', title: 'Fetch', keys: ['url'] };
  return { icon: '✦', title: 'Tool call', keys: [] };
}

/** The first of the harness's summary keys the tool actually sent, else its first short string. */
function toolSummary(input: Rec, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = str(input[key]);
    if (value) return value;
  }
  for (const value of Object.values(input)) {
    if (typeof value === 'string' && value.trim() && value.length <= 160) return value;
  }
  return undefined;
}

/** The row for a tool call, keeping what was already shown when an update carries only its id. */
function toolRow(update: Rec, remembered?: ToolRow): ToolRow {
  const wireName = (str(update.name) ?? str(update.title) ?? '').toLowerCase();
  const known = TOOL_ROWS.find((row) => row.name.test(wireName));
  const kind = str(update.kind);
  // A tool this office knows by name, else by what the call is doing, else what the row already said.
  const described = known ?? (wireName || kind ? kindRow(kind) : undefined);
  const base = described ?? remembered ?? kindRow(undefined);
  const input = isRec(update.rawInput) ? update.rawInput : undefined;
  let summary = input ? toolSummary(input, described?.keys ?? []) : undefined;
  if (!summary) summary = remembered?.summary;
  // An unknown tool's row leads with the tool's own name, the way the chat's generic row does.
  const raw = str(update.title) ?? str(update.name);
  if (!described && raw) summary = summary && summary !== raw ? `${oneLine(raw, 60)} · ${summary}` : oneLine(raw, 60);
  const detail = (input ? toolSummary(input, DETAIL_KEYS) : undefined) ?? remembered?.detail;
  return { icon: base.icon, title: base.title, summary: summary ? oneLine(summary, 160) : undefined, detail: detail ? bounded(detail) : undefined };
}

/** A tool row: icon, title, then the harness's dot separator before the summary. */
function toolLine(row: ToolRow): string {
  const summary = row.summary ? ` ${V.faint}·${V.reset} ${V.muted}${escapeText(row.summary)}${V.reset}` : '';
  return `  ${V.faint}${row.icon}${V.reset} ${V.secondary}${escapeText(row.title)}${V.reset}${summary}\r\n`;
}

/** Why a tool failed, from its raw output or its content blocks. */
function toolError(update: Rec): string | undefined {
  const raw = update.rawOutput;
  if (isRec(raw)) {
    const message = str(raw.message) ?? str(raw.error);
    if (message) return oneLine(message, 200);
  }
  if (typeof raw === 'string' && raw.trim()) return oneLine(raw, 200);
  const text = contentText(update);
  return text ? oneLine(text, 200) : undefined;
}

/** The text of a tool update's content blocks, in order. */
function contentText(update: Rec): string | undefined {
  const items = Array.isArray(update.content) ? update.content : [];
  const parts: string[] = [];
  for (const item of items) {
    if (!isRec(item)) continue;
    const direct = str(item.text);
    if (direct) {
      parts.push(direct);
      continue;
    }
    if (isRec(item.content)) {
      const nested = str(item.content.text);
      if (nested) parts.push(nested);
    }
  }
  return parts.length ? parts.join('\n') : undefined;
}

/**
 * Drop control characters and whole escape sequences from text the harness sent, so it cannot drive
 * the terminal — and so the remains of a sequence (`[2J`) never show up as if the model typed it.
 */
function escapeText(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC … BEL/ST (titles, hyperlinks)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '') // CSI (colors, cursor, clears)
    .replace(/\x1b[@-Z\\-_]/g, '') // other two-byte escapes
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ''); // whatever is left: BEL, 8-bit C1 (CSI, OSC), bidi overrides
}

/** Text the office writes into a DSH terminal that did not come through the renderer (a prompt, an error). */
export function terminalSafe(text: string): string {
  return escapeText(text);
}

/**
 * A small markdown renderer for the terminal, standing in for the chat's rich text: headings, rules,
 * quotes, bullets, bold, italic, inline code and links. Streaming is line-buffered upstream, so a
 * span is never split across chunks.
 */
function markdown(text: string, base: string): string {
  const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(text);
  if (heading) return `${V.bold}${V.underline}${escapeText(heading[2])}${V.reset}${base}`;
  if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(text)) return `${V.faint}${'─'.repeat(24)}${V.reset}${base}`;
  const quote = /^\s{0,3}>\s?(.*)$/.exec(text);
  if (quote) return `${V.muted}${THOUGHT_RULE} ${inline(quote[1], V.muted)}${V.reset}`;
  const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(text);
  if (bullet) return `${bullet[1]}${V.faint}•${V.reset}${base} ${inline(bullet[2], base)}`;
  return inline(text, base);
}

/**
 * Inline spans, always falling back to the line's own color after each one.
 *
 * Every span is swapped for a placeholder before the next pattern runs, and the ANSI is substituted
 * at the end: the escapes themselves contain `[`, which the link pattern would otherwise match
 * backwards into, corrupting every span on the line.
 */
function inline(raw: string, base: string): string {
  const painted: string[] = [];
  const hold = (ansi: string): string => {
    painted.push(ansi);
    return `\u0001${painted.length - 1}\u0001`;
  };
  const text = escapeText(raw)
    .replace(/`([^`]+)`/g, (_all, code: string) => hold(`${V.inlineCodeBg}${V.code}${code}${V.reset}${base}`))
    .replace(/\*\*([^*]+)\*\*/g, (_all, bold: string) => hold(`${V.bold}${bold}${V.reset}${base}`))
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, (_all, before: string, italic: string) => before + hold(`${V.italic}${italic}${V.reset}${base}`))
    .replace(/(^|[\s(])_([^_\n]+)_/g, (_all, before: string, italic: string) => before + hold(`${V.italic}${italic}${V.reset}${base}`))
    .replace(/\[([^\][]{1,500})\]\(([^)\s]{1,2000})\)/g, (_all, label: string, url: string) => hold(`${V.underline}${label}${V.reset}${base} ${V.muted}${url}${V.reset}${base}`));
  return text.replace(/\u0001(\d+)\u0001/g, (_all, index: string) => painted[Number(index)] ?? '');
}

/** The choices a select configuration option advertises, flattened across its groups. */
export function configOptionValues(option: unknown): { value: string; name?: string }[] {
  if (!isRec(option) || !Array.isArray(option.options)) return [];
  const values: { value: string; name?: string }[] = [];
  const add = (entry: unknown): void => {
    if (!isRec(entry)) return;
    const value = str(entry.value);
    if (value) values.push({ value, name: str(entry.name) });
  };
  for (const entry of option.options) {
    // Model options arrive grouped by provider: [{group, name, options: [...]}].
    if (isRec(entry) && Array.isArray(entry.options)) for (const inner of entry.options) add(inner);
    else add(entry);
  }
  return values;
}

/** The model inside an advertised route value, which DSH serializes as a JSON [provider, model] pair. */
function routeModel(value: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && typeof parsed[parsed.length - 1] === 'string') return String(parsed[parsed.length - 1]);
  } catch {
    // Not a route tuple: the value is already the id itself.
  }
  return undefined;
}

/**
 * Match what someone typed against the live catalog. DSH model values are opaque route tuples
 * (`["deepseek-official","deepseek-v4-pro"]`), so a person is far more likely to type the model
 * name: accept the exact value, the option's label, or the model inside the tuple. Anything that
 * matches nothing is passed through unchanged and the harness has the final say.
 */
export function resolveConfigValue(input: string, option: unknown): string {
  const wanted = input.trim();
  const values = configOptionValues(option);
  if (!values.length) return wanted;
  const exact = values.find((entry) => entry.value === wanted);
  if (exact) return exact.value;
  const byLabel = values.find((entry) => entry.name?.toLowerCase() === wanted.toLowerCase());
  if (byLabel) return byLabel.value;
  const byModel = values.find((entry) => (routeModel(entry.value) ?? '').toLowerCase() === wanted.toLowerCase());
  return byModel ? byModel.value : wanted;
}

/**
 * The office's effort levels on DSH's ladder (`off`, `low`, `high`, `max`). The office offers one
 * shared set for Claude and DSH, so the middle levels land on the nearest rung DSH has.
 */
export function dshEffort(effort: AgentEffort): string {
  if (effort === 'low') return 'low';
  if (effort === 'xhigh' || effort === 'max') return 'max';
  return 'high'; // medium and high: DSH's default balance
}

// ---------------------------------------------------------------------------
// Launch configuration
// ---------------------------------------------------------------------------

export function dshSessionsRoot(dataDir: string): string {
  return path.join(dataDir, DSH_SESSIONS_DIR);
}

/**
 * `dsh` argv: the office's own `--agent-args` first (so a DSH worker respects them), then the
 * profile, then the patch overlays. A trailing `--profile` wins over anything prepended.
 */
export function dshArgs(options: { profile: string; patches?: string[]; extra?: string[] }): string[] {
  const args = [...(options.extra ?? [])];
  args.push('--profile', options.profile);
  for (const patch of options.patches ?? []) args.push('--patch', patch);
  return args;
}

/**
 * The patch overlay that keeps a floor's DSH sessions under the office's own directory instead of
 * the user's `~/.dsh/sessions`, so the office can list and resume exactly what it started.
 * Written once per floor; the same file serves every DSH worker on it.
 */
export function writeDshPatch(dataDir: string): string {
  const file = path.join(dataDir, DSH_PATCH_FILE);
  const body = [
    '# Written by the office: keep DeepSeek Harness sessions in this checkout.',
    '- id: session-persistence-jsonl',
    '  config:',
    `    root: ${JSON.stringify(dshSessionsRoot(dataDir))}`,
    '',
  ].join('\n');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(file, body, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

export interface DshLaunch {
  /** The executable to run: the configured `dsh`, or one a test points at a fake agent. */
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** A model chosen for this worker, applied through `session/set_config_option`. */
  model?: string;
  effort?: AgentEffort;
  /** The session to carry on, when there is one (R on an exited worker, or a restart). */
  resumeSessionId?: string;
  /** Sent as the first prompt once the session is ready. */
  firstPrompt?: string;
}

export interface DshEvents {
  /** ANSI text for the worker's terminal. */
  output(text: string): void;
  status(status: WorkerStatus): void;
  action(action: WorkerAction | undefined): void;
  usage(usage: Usage): void;
  /** The session id the agent handed back, for the worker's card and for resume. */
  session(sessionId: string): void;
  /** A prompt someone typed into the terminal, for the worker's task card. */
  prompted(text: string): void;
  /** The child process ended. `quiet` marks a close the office asked for. */
  exit(code: number | null, error: string | undefined, quiet: boolean): void;
}

/**
 * One DSH worker's ACP connection. Serializes prompts (ACP allows one per session), answers
 * permission requests from the person at the terminal, and renders every update into the worker's
 * headless terminal through `events.output`.
 */
export class DshSession {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  private nextId = 100;
  private sessionId?: string;
  private buffer = '';
  private line = '';
  private permission?: { id: unknown; options: DshPermissionOption[] };
  private configOptions: Rec[] = [];
  private renderer = new DshRenderer();
  private prompting = false;
  private finished = false;
  private closing = false;
  private started = false;

  constructor(
    private launch: DshLaunch,
    private events: DshEvents,
  ) {}

  get id(): string | undefined {
    return this.sessionId;
  }

  get running(): boolean {
    return this.started && !this.finished;
  }

  /** Spawns the child and runs the ACP handshake. Everything after is driven by updates. */
  start(): void {
    if (this.started) return;
    this.started = true;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.launch.file, this.launch.args, {
        cwd: this.launch.cwd,
        env: this.launch.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.events.status('exited');
      this.events.exit(-1, reason(err), false);
      this.finished = true;
      return;
    }
    this.child = child;
    this.events.status('starting');

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.read(chunk));
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_TEXT);
    });
    child.on('error', (err) => this.finish(-1, err.message));
    child.on('exit', (code) => this.finish(code, stderr.trim() || undefined));

    void this.handshake();
  }

  /** Keystrokes from a browser: echoed, buffered to a line, submitted on Enter (see the doc). */
  writeInput(data: string): void {
    if (this.finished || !this.started) return;
    if (data === '\x1b') {
      this.cancelTurn();
      return;
    }
    // Arrow/function keys arrive as escape sequences: swallow them rather than typing them in.
    const cleaned = data.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1bO[@-~]/g, '');
    // A browser sends each key on its own, so Enter is a lone "\r". Several characters at once are a
    // paste, and a blank line in a paste must not press the approval's Enter (allow once); a choice
    // typed out ("1", an option's name) still has to match one of those listed.
    const burst = [...cleaned].length > 1;
    let echo = '';
    const flushEcho = () => {
      if (echo) this.events.output(echo);
      echo = '';
    };
    for (const ch of cleaned) {
      if (ch === '\r' || ch === '\n') {
        if (burst && this.permission && !this.line.trim()) continue;
        flushEcho();
        this.submitLine();
      } else if (ch === '\x7f' || ch === '\b') {
        if (this.line) {
          this.line = [...this.line].slice(0, -1).join('');
          echo += '\b \b';
        }
      } else if (ch === '\x03') {
        flushEcho();
        this.cancelTurn();
      } else if (ch < ' ' || /[\x80-\x9f\u202a-\u202e\u2066-\u2069]/.test(ch)) continue;
      else if (this.line.length < MAX_TYPED) {
        this.line += ch;
        echo += ch;
      }
    }
    flushEcho();
  }

  /** A prompt from the office (the prompt box, the queue, a board agent): echoed, then submitted. */
  prompt(text: string): void {
    const clean = text.replace(/\r\n?/g, '\n').trim();
    if (!clean) return;
    if (this.prompting) {
      this.events.output(notice('warn', 'one prompt at a time — this turn is still running'));
      return;
    }
    this.events.output(`${V.brand}${V.bold}>${V.reset} ${V.text}${escapeText(bounded(clean, MAX_LINE)).replace(/\n/g, '\r\n  ')}${V.reset}\r\n`);
    this.sendPrompt(clean);
  }

  /**
   * Escape / Ctrl+C. On an open approval this is the harness's Reject, which the tool records and
   * the turn carries on around; a tool that offers no reject choice is cancelled outright. With no
   * question open, it cancels the turn in flight.
   */
  cancelTurn(): void {
    if (this.finished) return;
    if (this.permission) {
      const reject = rejectOption(this.permission.options);
      this.answerPermission(reject?.optionId, !reject);
      if (!reject) this.notify('session/cancel', { sessionId: this.sessionId });
      return;
    }
    if (this.prompting) {
      this.events.output(`\r\n${notice('quiet', 'cancelled')}`);
      this.notify('session/cancel', { sessionId: this.sessionId });
      return;
    }
    this.line = '';
    this.events.output('\r\n');
  }

  /** Sends home: close the session quietly, then end the child. */
  close(): void {
    if (this.closing || this.finished) return;
    this.closing = true;
    if (this.sessionId) {
      // session/close is a request, but the office does not wait on it: the child goes either way.
      this.send({ jsonrpc: '2.0', id: ++this.nextId, method: 'session/close', params: { sessionId: this.sessionId } });
    }
    const child = this.child;
    setTimeout(() => {
      try {
        child?.kill('SIGTERM');
      } catch {
        // already gone
      }
    }, 500).unref?.();
  }

  // --- the handshake, and everything the agent sends back -------------------

  private async handshake(): Promise<void> {
    try {
      await this.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        clientInfo: { name: 'agent-office', version: '0.1.0' },
      });
    } catch (err) {
      this.fail(`DeepSeek Harness did not answer initialize: ${reason(err)}`);
      return;
    }

    // Only this worker's own session is carried on. Every desk without a worktree shares the checkout,
    // so "the newest session in this directory" may be another worker's, even one still running.
    let ready = false;
    if (this.launch.resumeSessionId) ready = await this.tryResume(this.launch.resumeSessionId);
    if (!ready && !(await this.newSession())) return;

    await this.applyChoices();
    if (this.launch.firstPrompt) this.prompt(this.launch.firstPrompt);
    else this.events.status('idle');
  }

  private async newSession(): Promise<boolean> {
    try {
      const result = await this.request('session/new', { cwd: this.launch.cwd, mcpServers: [] });
      const id = isRec(result) ? str(result.sessionId) : undefined;
      if (!id) throw new Error('session/new returned no session id');
      this.adopt(id, isRec(result) ? result.configOptions : undefined);
      this.events.output(notice('info', 'DeepSeek Harness ready'));
      return true;
    } catch (err) {
      this.fail(`DeepSeek Harness could not start a session: ${reason(err)}`);
      return false;
    }
  }

  private async tryResume(id: string): Promise<boolean> {
    try {
      const result = await this.request('session/resume', { sessionId: id, cwd: this.launch.cwd, mcpServers: [] });
      this.adopt(id, isRec(result) ? result.configOptions : undefined);
      this.events.output(notice('info', `resumed session ${id}`));
      return true;
    } catch (err) {
      this.events.output(notice('quiet', `could not resume session ${id}: ${oneLine(reason(err), 200)}`));
      return false;
    }
  }

  private adopt(id: string, configOptions: unknown): void {
    this.sessionId = id;
    this.configOptions = Array.isArray(configOptions) ? configOptions.filter(isRec) : [];
    this.events.session(id);
  }

  /** Model and reasoning effort chosen for this worker, if the live catalog offers them. */
  private async applyChoices(): Promise<void> {
    if (this.launch.model) await this.setConfig('model', this.launch.model);
    if (this.launch.effort) await this.setConfig('reasoning_effort', dshEffort(this.launch.effort));
  }

  private async setConfig(configId: string, wanted: string): Promise<void> {
    const option = this.configOptions.find((entry) => str(entry.id) === configId);
    if (!option) {
      this.events.output(notice('quiet', `the harness advertises no ${configId}; keeping the profile default`));
      return;
    }
    const value = resolveConfigValue(wanted, option);
    try {
      const result = await this.request('session/set_config_option', { sessionId: this.sessionId, configId, value });
      const options = isRec(result) ? result.configOptions : undefined;
      if (Array.isArray(options)) this.configOptions = options.filter(isRec);
      this.events.output(notice('quiet', `${configId} → ${oneLine(value, 160)}`));
    } catch (err) {
      // A stale saved model must not fail the launch: the profile default stays in force.
      this.events.output(notice('warn', `${configId} "${oneLine(wanted, 120)}" was not accepted (${oneLine(reason(err), 160)}); keeping the profile default`));
    }
  }

  private sendPrompt(clean: string): void {
    if (!this.sessionId) {
      this.events.output(notice('bad', 'no session to prompt yet'));
      return;
    }
    this.prompting = true;
    this.events.status('working');
    this.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text: clean }] }, 0)
      .then((result) => {
        this.prompting = false;
        const stop = isRec(result) ? str(result.stopReason) : undefined;
        this.events.output(this.renderer.endTurn(stop === 'cancelled' ? 'Stopped' : 'Worked'));
        this.events.action(undefined);
        // "Worked" and "Stopped" are the harness's own words for those two endings.
        if (stop && stop !== 'end_turn' && stop !== 'cancelled') this.events.output(notice('quiet', oneLine(stop, 80)));
        this.events.status('done');
      })
      .catch((err) => {
        this.prompting = false;
        this.events.output(this.renderer.endTurn('Failed'));
        this.events.output(notice('bad', `prompt failed: ${oneLine(reason(err), 300)}`));
        this.events.action(undefined);
        this.events.status('done');
      });
  }

  private submitLine(): void {
    const text = this.line;
    this.line = '';
    this.events.output('\r\n');
    if (this.permission) {
      // Enter on an empty line is the harness's Allow once; a number picks a listed choice.
      if (!text.trim()) {
        const once = allowOption(this.permission.options);
        if (once) this.answerPermission(once.optionId);
        else this.events.output(notice('warn', 'no allow-once choice here: type a listed number, or Esc'));
        return;
      }
      const pick = permissionChoice(text, this.permission.options);
      if (pick) {
        this.answerPermission(pick.optionId);
        return;
      }
      this.events.output(notice('warn', 'Enter allows once, Esc rejects, or type a listed number'));
      return;
    }
    if (text.trim()) {
      const clean = text.trim();
      // The office can see prompts it sends itself; this one came from the terminal, so it is told.
      this.events.prompted(clean);
      this.sendPrompt(clean);
    }
  }

  private answerPermission(optionId: string | undefined, cancelled = false): void {
    const permission = this.permission;
    if (!permission) return;
    this.permission = undefined;
    const outcome = cancelled || !optionId ? { outcome: 'cancelled' } : { outcome: 'selected', optionId };
    this.send({ jsonrpc: '2.0', id: permission.id, result: { outcome } });
    const label = cancelled || !optionId ? 'permission cancelled' : `permission answered: ${oneLine(optionId, 80)}`;
    this.events.output(notice('quiet', label));
    // Answering a prompt's question puts the turn back to work; answering autonomous work leaves the
    // session ready for the next prompt.
    this.events.status(this.prompting ? 'working' : 'idle');
  }

  private onPermission(id: unknown, params: unknown): void {
    const options = permissionOptions(params);
    this.permission = { id, options };
    const toolCall = isRec(params) && isRec(params.toolCall) ? params.toolCall : undefined;
    this.events.output(renderPermission(params, options, this.renderer.toolDetail(toolCall ? str(toolCall.toolCallId) : undefined)));
    this.events.status('needs_input');
  }

  private onUpdate(params: unknown): void {
    const update = isRec(params) ? params.update : undefined;
    const rendered = this.renderer.render(update);
    if (rendered.text) this.events.output(rendered.text);
    if (rendered.usage) this.events.usage(rendered.usage);
    if (rendered.action !== undefined) this.events.action(rendered.action);
  }

  // --- framing --------------------------------------------------------------

  private read(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const nl = this.buffer.indexOf('\n');
      if (nl < 0) break;
      const frame = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!frame) continue;
      let message: unknown;
      try {
        message = JSON.parse(frame);
      } catch {
        this.events.output(notice('quiet', 'unreadable ACP frame'));
        continue;
      }
      try {
        this.dispatch(message);
      } catch (err) {
        this.events.output(notice('quiet', `ACP frame skipped: ${oneLine(reason(err), 200)}`));
      }
    }
    // A frame that never ends is not a frame: drop it rather than grow without bound.
    if (this.buffer.length > MAX_FRAME) {
      this.buffer = '';
      this.events.output(notice('quiet', 'oversized ACP frame dropped'));
    }
  }

  private dispatch(message: unknown): void {
    if (!isRec(message)) return;
    const method = str(message.method);
    const id = message.id;
    if (method && id !== undefined && id !== null) {
      if (method === 'session/request_permission') this.onPermission(id, message.params);
      else this.send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unsupported: ${method}` } });
      return;
    }
    if (method) {
      if (method === 'session/update') this.onUpdate(message.params);
      return;
    }
    const waiter = typeof id === 'number' ? this.pending.get(id) : undefined;
    if (!waiter) return;
    this.pending.delete(id as number);
    if (message.error) waiter.reject(new Error(this.errorText(message.error)));
    else waiter.resolve(message.result);
  }

  private errorText(error: unknown): string {
    if (isRec(error)) return str(error.message) ?? 'unknown error';
    return 'unknown error';
  }

  private request(method: string, params: unknown, timeoutMs = CONTROL_TIMEOUT_MS): Promise<unknown> {
    if (!this.child || this.finished) return Promise.reject(new Error('the DeepSeek Harness process is not running'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
      if (timeoutMs > 0) {
        setTimeout(() => {
          if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
        }, timeoutMs).unref?.();
      }
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private send(message: unknown): void {
    const child = this.child;
    if (!child || this.finished || !child.stdin.writable) return;
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    } catch {
      // The exit handler reports a broken pipe.
    }
  }

  private fail(message: string): void {
    this.events.output(notice('bad', message));
    this.finish(-1, message);
  }

  private finish(code: number | null, error?: string): void {
    if (this.finished) return;
    this.finished = true;
    const quiet = this.closing;
    for (const waiter of this.pending.values()) waiter.reject(new Error('the DeepSeek Harness process ended'));
    this.pending.clear();
    this.child = undefined;
    this.events.exit(code, error, quiet);
  }
}
