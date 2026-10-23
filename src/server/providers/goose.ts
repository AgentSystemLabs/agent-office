// Goose keeps an interactive PTY open after its first --text prompt. A named run can be resumed
// with the same name, including a new first prompt, so each desk keeps its own conversation.
import type { ProviderAdapter } from './types.js';

const workerSession = (id: string): string => `agent-office-${id}`;

export const goose: ProviderAdapter = {
  id: 'goose',
  launch({ h, prompt, resumeSessionId }) {
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
    if (prompt) args.push('--text', prompt);

    return {
      args,
      finishEnv(env) {
        delete env.GOOSE_PROVIDER;
        delete env.GOOSE_MODEL;
        // Goose's saved max effort made a short tool task spend minutes thinking. This affects only
        // office workers; the person's Goose setting remains theirs for other sessions.
        env.GOOSE_THINKING_EFFORT = 'low';
      },
    };
  },
  titleNoise: /^goose$/i,
};
