// Cursor CLI: the person's own cursor-agent login, ~/.cursor and the project's .cursor stay as they
// are. Its hooks come in a plugin of the office's own, loaded with --plugin-dir (see ../cursor.ts),
// and report on /hooks/cursor. Its conversation id comes from its first sessionStart, and R resumes
// it with --resume. Its spend isn't metered by the office.
import { cursorArgs, normalizeCursorHook, writeCursorPlugin } from '../cursor.js';
import { reduceLifecycle } from '../workers/lifecycle.js';
import type { ProviderAdapter } from './types.js';

interface CursorSetup {
  /** The office's plugin folder, with its hooks. */
  plugin: string;
}

export const cursor: ProviderAdapter<undefined, CursorSetup> = {
  id: 'cursor',
  scrubEnv: ['CURSOR_AGENT', 'CURSOR_TRACE_ID'],
  prepare: ({ dataDir }) => ({ plugin: writeCursorPlugin(dataDir) }),
  launch({ h: { info }, args, prompt, resumeSessionId, setup }) {
    // A resumed chat fires no sessionStart, so a follow-up prompt goes on the command line too.
    return { args: cursorArgs(args, { plugin: setup.plugin, sessionId: resumeSessionId, model: info.model, prompt }), rotateToken: true };
  },
  titleNoise: /^cursor(?:[ -]agent)?$/i,
  // `--resume` of a chat Cursor no longer has exits straight away ("Failed to resume chat").
  freshIfResumeFails: true,
  hook: {
    strictJson: true,
    handle(h, event, payload) {
      const report = normalizeCursorHook(event, payload);
      return !!report && reduceLifecycle(h, report);
    },
  },
};
