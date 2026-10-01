import {
  antigravityArgs,
  ensureAntigravityWorkspace,
  normalizeAntigravityHook,
  writeAntigravityHookScript,
} from '../antigravity.js';
import { reduceLifecycle } from '../workers/lifecycle.js';
import type { ProviderAdapter } from './types.js';

export interface AntigravityState {
  hookScript?: string;
  mcpScript?: string;
}

export interface AntigravitySetup {
  hookScript: string;
  mcpScript?: string;
}

export const antigravity: ProviderAdapter<AntigravityState, AntigravitySetup> = {
  id: 'antigravity',
  createState: () => ({}),
  prepare({ dataDir, mcpScript }) {
    return {
      hookScript: writeAntigravityHookScript(dataDir),
      mcpScript,
    };
  },
  launch({ h, args, prompt, resumeSessionId, setup }) {
    const { info } = h;
    h.state.hookScript = setup.hookScript;
    h.state.mcpScript = setup.mcpScript;
    args = antigravityArgs(args, {
      model: info.model,
      effort: info.effort,
      prompt,
      resumeSessionId,
    });
    return {
      args,
      rotateToken: true,
    };
  },
  usage: {
    locate(h, cwd) {
      if (h.state.hookScript) {
        ensureAntigravityWorkspace(cwd, h.state.hookScript, h.state.mcpScript);
      }
    },
  },
  bootHint: 'Open the terminal: sign in or accept prompts if Antigravity asks',
  titleNoise: /^agy(\.exe)?$/i,
  hook: {
    strictJson: true,
    handle(h, event, payload) {
      const report = normalizeAntigravityHook(event, payload);
      return !!report && reduceLifecycle(h, report);
    },
  },
};
