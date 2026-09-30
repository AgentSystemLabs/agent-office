// Pi: an extension the office writes and loads with --extension (see ../pi.ts), so the person's own
// Pi login, settings, packages and extensions stay as they are. It reports on /hooks/pi in the same
// statuses as OpenCode's plugin. Each desk keeps its sessions in a folder of its own, so a worker
// never resumes another's conversation. Its spend isn't metered by the office.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { normalizePiHook, piArgs, writePiExtension } from '../pi.js';
import { reduceStatus, type StatusState } from './opencode.js';
import type { ProviderAdapter } from './types.js';

interface PiSetup {
  /** The office's extension. */
  extension: string;
  /** Where each desk's session folder goes (pi-sessions/<worker id>). */
  dataDir: string;
}

export const pi: ProviderAdapter<StatusState, PiSetup> = {
  id: 'pi',
  createState: () => ({}),
  prepare: ({ dataDir }) => ({ extension: writePiExtension(dataDir), dataDir }),
  launch({ h, args, prompt, resumeSessionId, setup }) {
    const { info } = h;
    const sessionDir = path.join(setup.dataDir, 'pi-sessions', info.id);
    mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
    h.state.error = false;
    // --session-id picks up the desk's own conversation, even one Pi hadn't written to disk yet.
    return { args: piArgs(args, { extension: setup.extension, sessionDir, sessionId: resumeSessionId, model: info.model, effort: info.effort, prompt }), rotateToken: true };
  },
  bootHint: 'Open the terminal: complete Pi login or project setup',
  hook: {
    strictJson: true,
    handle(h, _event, payload) {
      const report = normalizePiHook(payload);
      // Pi is up once its extension reports, so the desk isn't stuck at start any more. A session
      // starting (a new one, or one resumed) leaves it ready for a prompt.
      return !!report && reduceStatus(h, report, { onReport: () => (h.bootBlocked = false), idleOnStart: true });
    },
  },
};
