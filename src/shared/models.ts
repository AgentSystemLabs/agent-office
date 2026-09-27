// Which Claude model a worker runs on, and how hard it thinks: picked when it's hired.

/** Claude Code's model aliases (`claude --model <alias>`), biggest first. */
export const CLAUDE_MODELS = ['fable', 'opus', 'sonnet', 'haiku'] as const;
export type ModelFamily = (typeof CLAUDE_MODELS)[number];

/** Claude Code's `--effort` levels, least thinking first. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value);
}

/**
 * A model Claude Code takes on its command line: an alias, or a full name like
 * `claude-haiku-4-5-20251001`, either with Claude Code's `[1m]` long-context suffix.
 */
export function isClaudeModel(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100 && /^(?:fable|opus|sonnet|haiku|claude-[a-z0-9][a-z0-9.-]*)(?:\[1m\])?$/.test(value);
}

/** Fable, Opus, Sonnet or Haiku, from an alias or any full model name (OpenCode's provider/model too). */
export function modelFamily(model: string | undefined): ModelFamily | undefined {
  const m = model && /fable|opus|sonnet|haiku/i.exec(model);
  return m ? (m[0].toLowerCase() as ModelFamily) : undefined;
}

/** A model's name for people: `claude-haiku-4-5-20251001` → "Haiku 4.5", `opus` → "Opus", `openai/gpt-5` → "gpt-5". */
export function modelLabel(model: string): string {
  const base = model.slice(model.lastIndexOf('/') + 1);
  // Both orders: claude-opus-4-5 and the older claude-3-5-haiku, dated or not.
  const m = /^(?:claude-)?(?:(\d{1,2}(?:-\d{1,2})?)-)?(fable|opus|sonnet|haiku)(?:-(\d{1,2}(?:-\d{1,2})?))?(?:-\d{8})?(\[1m\])?$/i.exec(base);
  if (!m) return base;
  const version = (m[3] ?? m[1])?.replace('-', '.');
  const family = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
  return `${family}${version ? ` ${version}` : ''}${m[4] ? ' 1M' : ''}`;
}
