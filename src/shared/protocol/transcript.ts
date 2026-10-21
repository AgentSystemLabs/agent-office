// A worker's conversation as a chat: what was said to it, what it said back and what it did, read
// off its agent's transcript (Claude Code's session log) rather than its terminal.

/** One entry of a worker's chat. */
export interface ChatItem {
  id: string;
  /** When it was written, ms since the epoch. */
  at: number;
  /** `you`: a prompt from a person; `agent`: what it said; `tool`: something it did; `note`: the session itself (an interruption, a /clear). */
  role: 'you' | 'agent' | 'tool' | 'note';
  text?: string;
  tool?: ChatTool;
}

/** A tool the agent used: what it ran, and what came back once it had. */
export interface ChatTool {
  name: string;
  /** The gist of its input: the command, the file, the pattern, the question. */
  input: string;
  /** What it got back, cut short; unset until it has. */
  result?: string;
  error?: boolean;
}

export type TranscriptClientMsg =
  /** Follow this worker's chat: answered with its latest items (`reset`), then each new one as it's written. */
  | { t: 'transcript.attach'; workerId: string }
  | { t: 'transcript.detach'; workerId: string }
  /** The items before `before` (an item id), oldest kept first. */
  | { t: 'transcript.more'; workerId: string; before: string };

export type TranscriptServerMsg =
  /**
   * `reset`: the latest items, replacing what the browser has; `append`: new ones; `prepend`: older
   * ones asked for; `patch`: items the browser has, changed (a tool's result came back). `more`: there
   * are older items than the first one here.
   */
  | { t: 'transcript.items'; workerId: string; mode: 'reset' | 'append' | 'prepend' | 'patch'; items: ChatItem[]; more?: boolean }
  /** No chat for this worker, and why (not a Claude Code worker, or nothing written yet). */
  | { t: 'transcript.none'; workerId: string; why: string };
