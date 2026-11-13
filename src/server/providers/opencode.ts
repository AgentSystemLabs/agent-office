// OpenCode: a plugin the office writes (see ../opencode.ts), loaded through OPENCODE_CONFIG_CONTENT,
// reports statuses and usage snapshots on /hooks/opencode.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { toolAction } from '../../shared/actions.js';
import { personaBrief, personaFor } from '../../shared/personas.js';
import { openCodeMcp } from '../office-workers.js';
import { mergeOpenCodeConfigContent, openCodePluginSpecifier, writeOpenCodePlugin, type OpenCodeStatusEvent } from '../opencode.js';
import { reportedUsage } from '../reported-usage.js';
import type { WorkerHandle } from '../workers/types.js';
import { truncate } from '../workers/util.js';
import type { ProviderAdapter } from './types.js';

/** What a worker that reports statuses (OpenCode's plugin, Pi's extension) keeps of them. */
export interface StatusState {
  /** An error keeps the desk visibly actionable until a new turn starts. */
  error?: boolean;
}

/** Where a provider's statuses differ (see reduceStatus). */
export interface StatusOptions {
  /** Each event it takes, once its session is settled. */
  onReport?(): void;
  /** Its session starting leaves it idle whatever it was doing, not only while it was starting up. */
  idleOnStart?: boolean;
}

interface OpenCodeSetup {
  plugin: string;
  mcpScript?: string;
  /** The project's checkout: the seed its desks' personas are dealt from. */
  dir: string;
  /** The floor's data dir, where a worker's persona file goes. */
  dataDir: string;
}

function withoutOpenCodeModel(args: string[]): string[] {
  const clean: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--model' || arg === '-m') {
      if (args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
      continue;
    }
    if (arg.startsWith('--model=') || (arg.startsWith('-m') && arg.length > 2)) continue;
    clean.push(arg);
  }
  return clean;
}

function isOpenCodeHookEvent(value: unknown): value is OpenCodeStatusEvent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.type === 'string' && ['session', 'prompt', 'tool', 'permission', 'question', 'error'].includes(v.type)
    && typeof v.sessionId === 'string' && v.sessionId.length > 0
    && typeof v.status === 'string' && ['starting', 'working', 'needs_input', 'done'].includes(v.status)
    && (v.prompt === undefined || typeof v.prompt === 'string')
    && (v.tool === undefined || typeof v.tool === 'string')
    && (v.detail === undefined || typeof v.detail === 'string');
}

/** OpenCode plugin callback. The plugin has already filtered child sessions before this bridge. */
function openCodeHook(h: WorkerHandle<StatusState>, _event: string, payload: unknown): boolean {
  const { info } = h;
  if (payload && typeof payload === 'object' && 'type' in payload && payload.type === 'usage') {
    const report = payload as { sessionId?: unknown; usage?: unknown };
    const usage = reportedUsage(report.usage);
    if (!usage || !info.sessionId || report.sessionId !== info.sessionId) return false;
    // Full snapshots replace previous totals. They never advance task status or enter the Claude ledger.
    info.usage = usage;
    h.emit();
    h.persist();
    return true;
  }
  return isOpenCodeHookEvent(payload) && reduceStatus(h, payload);
}

/**
 * One status event for a worker. An event from another session is only taken when that session
 * starts, and the worker's task starts over with it. Says whether it was taken.
 */
export function reduceStatus(h: WorkerHandle<StatusState>, payload: OpenCodeStatusEvent, o: StatusOptions = {}): boolean {
  const { info, state } = h;
  if (info.sessionId && info.sessionId !== payload.sessionId && !(payload.type === 'session' && payload.status === 'starting')) return false;
  if (!info.sessionId || (payload.type === 'session' && payload.status === 'starting' && info.sessionId !== payload.sessionId)) {
    const switching = !!info.sessionId;
    info.sessionId = payload.sessionId;
    if (switching) {
      info.usage = undefined;
      h.clearTask();
      info.activity = undefined;
      h.setStatus('idle');
    }
    state.error = false;
    h.persist();
  }
  o.onReport?.();
  if (payload.type === 'error') state.error = true;
  else if (payload.status === 'working' || payload.prompt) state.error = false;
  if (payload.prompt) {
    info.activity = truncate(payload.prompt, 80);
    info.action = undefined;
    h.notePrompt(payload.prompt);
  } else if (payload.tool) {
    info.activity = truncate(payload.tool, 80);
    info.action = toolAction(payload.tool);
  } else if (payload.detail) {
    info.activity = truncate(payload.detail, 80);
  }
  if (payload.status === 'needs_input') h.setStatus('needs_input');
  else if (payload.status === 'working') h.setStatus('working');
  else if (payload.status === 'done' && h.running) h.setStatus(state.error ? 'needs_input' : 'done');
  else if (payload.status === 'starting' && (info.status === 'starting' || o.idleOnStart)) h.setStatus('idle');
  else h.emit();
  return true;
}

export const opencode: ProviderAdapter<StatusState, OpenCodeSetup> = {
  id: 'opencode',
  createState: () => ({}),
  prepare: ({ dataDir, dir, mcpScript }) => ({ plugin: writeOpenCodePlugin(dataDir), mcpScript, dir, dataDir }),
  launch({ h, args, prompt, resumeSessionId, station, setup }) {
    const { info } = h;
    // Its desk's persona, dealt from the floor's seed (see shared/personas.ts): OpenCode has no
    // system-prompt flag, so it goes in as an `instructions` file its config content names. Board
    // kiosks keep their briefs.
    let personaFile: string | undefined;
    const persona = station ? undefined : personaFor(setup.dir, info.deskId);
    if (persona) {
      const dir = path.join(setup.dataDir, 'personas');
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      personaFile = path.join(dir, `${info.id}.md`);
      writeFileSync(personaFile, personaBrief(persona), { mode: 0o600 });
    }
    if (resumeSessionId || info.model) args = withoutOpenCodeModel(args);
    if (!resumeSessionId && info.model) args.push('--model', info.model);
    if (resumeSessionId) args.push('--session', resumeSessionId);
    if (prompt) args.push('--prompt', prompt);
    h.state.error = false;
    return {
      args,
      rotateToken: true,
      finishEnv(env) {
        env.AGENT_OFFICE_SESSION_ID = resumeSessionId ?? '';
        // Its effort, which OpenCode's TUI has no flag for: the plugin puts its first message on it
        // (see ../opencode.ts). Like its model, it's for a fresh session: a resumed one carries on with its own.
        env.AGENT_OFFICE_EFFORT = (!resumeSessionId && info.effort) || '';
        env.AGENT_OFFICE_MODEL = (!resumeSessionId && info.model) || '';
        env.OPENCODE_CONFIG_CONTENT = mergeOpenCodeConfigContent(env.OPENCODE_CONFIG_CONTENT, openCodePluginSpecifier(setup.plugin), setup.mcpScript ? openCodeMcp(setup.mcpScript) : undefined, personaFile ? [pathToFileURL(personaFile).href] : undefined);
      },
    };
  },
  hook: { strictJson: true, handle: openCodeHook },
  usage: { persisted: true },
};
