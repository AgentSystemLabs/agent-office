import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isAgentEffort, isAgentProvider, type AgentChoice, type AgentProvider, type PromptsState } from '../shared/protocol.js';
import { PROMPTS, PROMPT_MAX, fillPrompt, isPromptId, promptText, type PromptId, type PromptVars } from '../shared/prompts.js';
import { validateWorkerEffort, validateWorkerModel } from './agents.js';

/** What the floors read: a prompt as the office has it now, and what workers start on. */
export interface PromptSource {
  text(id: PromptId): string;
  /** The worker picked in ⚙️ Settings, when one was. */
  agent(): AgentChoice | undefined;
}

/** A prompt's text, from `source` when there is one, else the default. */
export function officePrompt(source: PromptSource | undefined, id: PromptId, vars: PromptVars = {}): string {
  return fillPrompt(source ? source.text(id) : PROMPTS[id].text, vars);
}

/**
 * The prompts the office writes for workers by itself (shared/prompts.ts), as rewritten in
 * ⚙️ Settings, and the provider, model and effort every worker starts on unless whoever starts it
 * picks others. The same for the whole building, kept in .agent-office/prompts.json; admins change them.
 */
export class OfficePrompts implements PromptSource {
  private saved: PromptsState = { custom: {} };
  private path: string;

  constructor(
    dataDir: string,
    /** The providers this office can start, and the one it was started with (--agent). */
    private providers: { list: AgentProvider[]; configured: AgentProvider },
    private onState: (state: PromptsState) => void,
  ) {
    this.path = path.join(dataDir, 'prompts.json');
    this.restore();
  }

  state(): PromptsState {
    return { custom: { ...this.saved.custom }, ...(this.saved.agent ? { agent: { ...this.saved.agent } } : {}) };
  }

  text(id: PromptId): string {
    return promptText(this.saved.custom, id);
  }

  agent(): AgentChoice | undefined {
    const a = this.saved.agent;
    return a && { provider: a.provider, ...(a.model ? { model: a.model } : {}), ...(a.effort ? { effort: a.effort } : {}) };
  }

  /** Rewrites a prompt; `text` null (or the default's own text) puts the default back. Returns why it can't, if it can't. */
  setPrompt(id: unknown, text: string | null, by: string): string | undefined {
    if (!isPromptId(id)) return 'Unknown prompt';
    const def = PROMPTS[id];
    const clean = text === null ? null : text.replace(/\r\n?/g, '\n').trim();
    if (clean !== null && clean.length > PROMPT_MAX) return `A prompt can be ${PROMPT_MAX.toLocaleString('en-US')} characters at most`;
    if (clean === '' && !def.optional) return 'That prompt can’t be empty: write something, or put the default back';
    if (clean === null || clean === def.text) delete this.saved.custom[id];
    else this.saved.custom[id] = { text: clean, by, at: Date.now() };
    this.changed();
    return undefined;
  }

  /** Picks the worker everyone starts on; null goes back to the one the office was started with. */
  setAgent(choice: AgentChoice | null, by: string): string | undefined {
    if (!choice) {
      delete this.saved.agent;
      this.changed();
      return undefined;
    }
    const why = this.problem(choice);
    if (why) return why;
    this.saved.agent = { provider: choice.provider, ...(choice.model ? { model: choice.model } : {}), ...(choice.effort ? { effort: choice.effort } : {}), by, at: Date.now() };
    this.changed();
    return undefined;
  }

  private problem(c: AgentChoice): string | undefined {
    if (!isAgentProvider(c.provider) || !this.providers.list.includes(c.provider)) return 'Unknown agent provider';
    if (c.provider === 'custom' && this.providers.configured !== 'custom') return 'Custom is not the configured agent provider';
    return validateWorkerModel('agent', c.provider, c.model) ?? validateWorkerEffort('agent', c.provider, c.effort);
  }

  private changed() {
    this.persist();
    this.onState(this.state());
  }

  private restore() {
    let raw: Partial<PromptsState>;
    try {
      raw = JSON.parse(readFileSync(this.path, 'utf8'));
    } catch {
      return; // never changed: the defaults
    }
    for (const [id, v] of Object.entries(raw?.custom ?? {})) {
      if (!isPromptId(id) || typeof v?.text !== 'string') continue;
      this.saved.custom[id] = { text: v.text.slice(0, PROMPT_MAX), by: typeof v.by === 'string' ? v.by : 'someone', at: typeof v.at === 'number' ? v.at : 0 };
    }
    const a = raw?.agent;
    if (a && isAgentProvider(a.provider)) {
      const choice: AgentChoice = { provider: a.provider, model: typeof a.model === 'string' ? a.model : undefined, effort: isAgentEffort(a.effort) ? a.effort : undefined };
      // One the office can't start any more (it was started with another --agent) is forgotten.
      if (!this.problem(choice)) this.saved.agent = { ...choice, by: typeof a.by === 'string' ? a.by : 'someone', at: typeof a.at === 'number' ? a.at : 0 };
    }
  }

  private persist() {
    try {
      writeFileSync(this.path, JSON.stringify(this.saved, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
