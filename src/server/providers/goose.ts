// Goose keeps an interactive PTY open after its first --text prompt. A named run can be resumed
// with the same name, including a new first prompt, so each desk keeps its own conversation.
import type { ProviderAdapter } from './types.js';
import { addGooseHooks, writeGooseHook } from '../goose-hooks.js';
import { reduceStatus, type StatusState } from './opencode.js';
import type { OpenCodeStatusEvent } from '../opencode.js';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveCommand } from '../workers/process.js';

const workerSession = (id: string): string => `agent-office-${id}`;
export const GOOSE_OFFICE_MODEL = 'nvidia/nemotron-3.5-super-vl-120b-a12b';

export const goose: ProviderAdapter<StatusState, { hook: string }> = {
  id: 'goose',
  createState: () => ({}),
  prepare: ({ dataDir }) => ({ hook: writeGooseHook(dataDir) }),
  launch({ h, prompt, resumeSessionId, cwd, setup }) {
    addGooseHooks(cwd, setup.hook);
    const name = workerSession(h.info.id);
    const resume = resumeSessionId === name;
    h.info.sessionId = name;

    // The office owns session and provider selection here. In particular, old --agent-args and
    // inherited GOOSE_PROVIDER/GOOSE_MODEL values must not override Goose's saved NVIDIA setup.
    // `goose run` requires a prompt even with --interactive. When Office wakes a desk with no
    // carry-on prompt (for example after restart), enter its saved session directly instead.
    const args = resume && !prompt
      ? ['session', '--resume', '--name', name]
      : ['run', '--interactive', '--name', name];
    if (resume && prompt) args.push('--resume');
    args.push('--provider', 'nvidia', '--model', GOOSE_OFFICE_MODEL);
    if (prompt) args.push('--text', prompt);

    return {
      args,
      rotateToken: true,
      finishEnv(env) {
        env.AGENT_OFFICE_INITIAL_PROMPT = prompt ? '1' : '0';
        if (process.platform === 'win32') {
          const git = resolveCommand('git');
          const shDir = git && path.resolve(path.dirname(git), '..', 'usr', 'bin');
          if (!shDir || !existsSync(path.join(shDir, 'sh.exe'))) throw new Error('Goose Office lifecycle hooks require Git for Windows sh.exe.');
          const key = Object.keys(env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH';
          env[key] = [shDir, env[key] ?? process.env.PATH ?? ''].join(path.delimiter);
        }
        delete env.GOOSE_PROVIDER;
        delete env.GOOSE_MODEL;
        // Goose's saved max effort made a short tool task spend minutes thinking. This affects only
        // office workers; the person's Goose setting remains theirs for other sessions.
        env.GOOSE_THINKING_EFFORT = 'low';
      },
    };
  },
  hook: {
    strictJson: true,
    handle(h, _event, value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const p = value as Record<string, unknown>;
      if (p.sessionId !== workerSession(h.info.id)
        || !['session', 'prompt', 'tool'].includes(String(p.type))
        || !['starting', 'working', 'done'].includes(String(p.status))
        || (p.tool !== undefined && (typeof p.tool !== 'string' || p.tool.length > 120))) return false;
      return reduceStatus(h, p as unknown as OpenCodeStatusEvent, { idleOnStart: true });
    },
  },
  titleNoise: /^goose$/i,
};
