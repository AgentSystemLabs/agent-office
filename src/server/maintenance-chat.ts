import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { MaintenanceChatMessage, MaintenanceConversation, WorkerInfo } from '../shared/protocol.js';

const BATCH_BYTES = 2 * 1024 * 1024;
const MAX_CONTENT = 100_000;

/** Only public user/assistant text, never tools, reasoning, hook credentials or environment context. */
export function transcriptMessage(row: any): { role: 'user' | 'assistant'; content: string; phase?: string } | undefined {
  const message = row.type === 'response_item' ? row.payload : row.message;
  if (!message || (row.type !== 'response_item' && !['user', 'assistant'].includes(row.type))) return;
  if (message.role !== 'user' && message.role !== 'assistant') return;
  if (message.channel === 'analysis' || row.channel === 'analysis' || message.phase === 'analysis') return;
  const blocks = message.content;
  const content = typeof blocks === 'string' ? blocks : Array.isArray(blocks)
    ? blocks.filter((b: any) => b && ['text', 'input_text', 'output_text'].includes(b.type) && typeof b.text === 'string').map((b: any) => b.text).join('\n\n') : '';
  if (!content.trim()) return;
  let clean = content;
  if (message.role === 'user') {
    // The first request is wrapped in the station brief; follow-ups carry the TV instructions.
    if (clean.startsWith("You're the Maintenance agent in Agent Office")) clean = clean.split('\n\nThe request:\n\n').at(-1) ?? clean;
    const tv = clean.indexOf('\n\nOffice TV:');
    if (tv >= 0) clean = clean.slice(0, tv);
    if (/^<(?:environment_context|permissions instructions|turn_aborted|system_reminder)>/.test(clean.trim())) return;
  }
  if (!clean.trim()) return;
  clean = clean.trim();
  const truncated = '\n\n[Message truncated; open the terminal for the rest.]';
  if (clean.length > MAX_CONTENT) clean = clean.slice(0, MAX_CONTENT - truncated.length) + truncated;
  return { role: message.role, content: clean, ...(typeof message.phase === 'string' ? { phase: message.phase.slice(0, 30) } : {}) };
}

/** Incremental, bounded reads of the worker's own structured transcript. Replays have stable IDs. */
export class MaintenanceTranscriptReader {
  private fileKey = '';
  private offset = 0;
  private skipping = false;
  read(file: string, session: string, provider: string, home?: string): MaintenanceChatMessage[] {
    let fd: number | undefined;
    try {
      const target = realpathSync(file);
      if (provider === 'codex') {
        if (!home) return [];
        const relative = path.relative(realpathSync(home), target).split(path.sep);
        if (!['sessions', 'archived_sessions'].includes(relative[0]) || relative.includes('..') || !path.basename(target).endsWith(`-${session}.jsonl`)) return [];
      } else if (path.basename(target) !== `${session}.jsonl`) return [];
      fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd);
      if (!stat.isFile()) return [];
      if (provider === 'codex') {
        const head = Buffer.alloc(Math.min(stat.size, 64 * 1024));
        readSync(fd, head, 0, head.length, 0);
        const end = head.indexOf(10);
        if (end < 0) return [];
        const meta = JSON.parse(head.subarray(0, end).toString('utf8'));
        if (meta.type !== 'session_meta' || meta.payload?.id !== session) return [];
      }
      const key = `${target}:${session}:${stat.dev}:${stat.ino}`;
      if (key !== this.fileKey || stat.size < this.offset) { this.fileKey = key; this.offset = 0; this.skipping = false; }
      const buffer = Buffer.alloc(Math.min(BATCH_BYTES, stat.size - this.offset));
      const bytes = readSync(fd, buffer, 0, buffer.length, this.offset);
      const data = buffer.subarray(0, bytes);
      const messages: MaintenanceChatMessage[] = [];
      let start = 0;
      for (let end = data.indexOf(10); end >= 0; end = data.indexOf(10, start)) {
        const line = data.subarray(start, end);
        const position = this.offset + start;
        start = end + 1;
        if (this.skipping) { this.skipping = false; continue; }
        if (line.length > 512 * 1024) continue;
        try {
          const row = JSON.parse(line.toString('utf8'));
          if (provider !== 'codex' && row.sessionId !== session) continue;
          const message = transcriptMessage(row);
          if (!message) continue;
          const at = Date.parse(row.timestamp);
          const id = createHash('sha256').update(`${session}:${position}:${line.toString('utf8')}`).digest('hex').slice(0, 32);
          messages.push({ id, ...message, at: Number.isFinite(at) ? at : stat.mtimeMs });
        } catch { /* Incomplete or unfamiliar rows are not chat messages. */ }
      }
      this.offset += start;
      // A line larger than a batch must not stall the reader or grow memory without bound.
      if (!start && bytes === BATCH_BYTES) { this.offset += bytes; this.skipping = true; }
      return messages;
    } catch { return []; }
    finally { if (fd !== undefined) closeSync(fd); }
  }
}

const validMessage = (m: any): m is MaintenanceChatMessage => m && typeof m.id === 'string' && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.length <= MAX_CONTENT && Number.isFinite(m.at);

/** Shared office history survives worker departure, worktree deletion and office restart. */
export class MaintenanceChatArchive {
  private file: string;
  private conversations: MaintenanceConversation[] = [];
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'maintenance-chat-archive.json');
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8'));
      if (Array.isArray(saved)) this.conversations = saved.filter(c => c && typeof c.id === 'string' && typeof c.title === 'string' && Number.isFinite(c.createdAt) && Number.isFinite(c.updatedAt) && Array.isArray(c.messages))
        .map(c => ({ ...c, messages: c.messages.filter(validMessage) }));
    } catch { /* First run or invalid saved history. */ }
  }
  list() {
    return [...this.conversations].sort((a, b) => b.updatedAt - a.updatedAt).map(({ messages, ...c }) => ({ ...c, count: messages.length }));
  }
  page(id: string, before?: string) {
    const c = this.conversations.find(c => c.id === id);
    if (!c) return undefined;
    const index = before ? c.messages.findIndex(m => m.id === before) : c.messages.length;
    const end = index < 0 ? c.messages.length : index;
    const start = Math.max(0, end - 100);
    return { ...c, messages: c.messages.slice(start, end), hasOlder: start > 0 };
  }
  capture(worker: WorkerInfo, incoming: MaintenanceChatMessage[]) {
    if (!incoming.length) return;
    const old = this.conversations.find(c => c.id === worker.id);
    const conversation: MaintenanceConversation = old ? { ...old, messages: [...old.messages] } : { id: worker.id, title: 'Maintenance conversation', createdAt: worker.createdAt, updatedAt: worker.createdAt, messages: [] };
    let changed = false;
    for (const message of incoming.filter(validMessage)) {
      if (conversation.messages.some(m => m.id === message.id)) continue;
      // Accepted requests appear immediately, then acquire the transcript's stable ID once logged.
      const pending = message.role === 'user' && !message.pending ? conversation.messages.findIndex(m => m.pending && m.content === message.content) : -1;
      if (pending >= 0) conversation.messages[pending] = { ...message, by: conversation.messages[pending].by };
      else conversation.messages.push(message);
      changed = true;
    }
    if (!changed) return;
    conversation.messages.sort((a, b) => a.at - b.at);
    conversation.title = (conversation.messages.find(m => m.role === 'user')?.content ?? 'Maintenance conversation').replace(/\s+/g, ' ').slice(0, 100);
    conversation.updatedAt = Math.max(conversation.updatedAt, ...incoming.map(m => m.at));
    const next = [...this.conversations.filter(c => c.id !== worker.id), conversation];
    writeFileSync(this.file + '.tmp', JSON.stringify(next), { mode: 0o600 });
    renameSync(this.file + '.tmp', this.file);
    this.conversations = next;
  }
}
