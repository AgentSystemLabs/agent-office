// Cursor CLI: its hooks go in the hooks.json of the folder each worker runs in (see ../cursor.ts),
// since that and ~/.cursor, which the office never touches, are the only places it reads them from,
// and report on /hooks/cursor. It runs on the machine's own Cursor login. Its spend isn't metered by
// the office, and nothing tells the office about a permission prompt: a worker waiting on one shows
// as working until it's answered.
import { addCursorHooks, cursorBlocked, normalizeCursorHook, removeCursorHooks, withoutCursorLaunchArgs, writeCursorHook } from '../cursor.js';
import { reduceLifecycle } from '../workers/lifecycle.js';
import type { ProviderAdapter } from './types.js';

interface CursorSetup {
  /** The helper its hooks run. */
  hook: string;
}

export const cursor: ProviderAdapter<undefined, CursorSetup> = {
  id: 'cursor',
  // What Cursor sets in its own shells. CURSOR_API_KEY stays: a worker signs in with it when it's set.
  scrubEnv: ['CURSOR_AGENT', 'CURSOR_CLI', 'CURSOR_INVOKED_AS', 'CURSOR_CONVERSATION_ID', 'CURSOR_REQUEST_ID'],
  prepare: ({ dataDir }) => ({ hook: writeCursorHook(dataDir) }),
  launch({ h: { info }, args, prompt, resumeSessionId, cwd, setup }) {
    args = withoutCursorLaunchArgs(args);
    addCursorHooks(cwd, setup.hook, info.id);
    // The office made this folder for it. Cursor's own permission prompts stay as they are.
    args.push('--trust');
    // Its chat id is the first one its hooks name. A resumed chat keeps the model it had.
    if (resumeSessionId) args.push(`--resume=${resumeSessionId}`);
    else if (info.model) args.push('--model', info.model);
    if (prompt) args.push('--', prompt);
    return { args, rotateToken: true };
  },
  exited: ({ info }, cwd) => removeCursorHooks(cwd, info.id),
  titleNoise: /^cursor( agent| cli)?$/i,
  hook: {
    strictJson: true,
    handle(h, event, payload) {
      const report = normalizeCursorHook(event, payload);
      if (!report) return false;
      // A chat started over inside the terminal fires no sessionStart: its first prompt is the first the office hears of it.
      if (report.event === 'UserPromptSubmit' && h.info.sessionId && h.info.sessionId !== report.sessionId) {
        reduceLifecycle(h, { sessionId: report.sessionId, event: 'SessionStart', source: 'clear' });
      }
      return reduceLifecycle(h, report);
    },
  },
  // A resumed chat fires no sessionStart, so it's idle as soon as it runs; the login screen is read off its terminal.
  screen: { blocked: cursorBlocked },
};
