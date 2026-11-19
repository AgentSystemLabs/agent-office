// DeepAI Code: the Pi agent the app ships, started through the launcher the office writes (see
// ../deepai.ts), on the app's own agent folder and sign-in. It reports on /hooks/deepai in the same
// statuses as Pi's extension, so its desk shows working, needs input and done the same way. Each
// desk keeps its sessions in a folder of its own, and its spend stays in the DeepAI account.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { deepaiApp, deepaiFreeModel, writeDeepaiLauncher } from '../deepai.js';
import { normalizePiHook, piArgs, writePiExtension } from '../pi.js';
import { reduceStatus, type StatusState } from './opencode.js';
import type { ProviderAdapter } from './types.js';

interface DeepaiSetup {
  /** The office's extension, reporting on /hooks/deepai. */
  extension: string;
  /** Where each desk's session folder goes (deepai-sessions/<worker id>). */
  dataDir: string;
  /** The launcher's path, when DeepAI Code is installed on this machine. */
  launcher?: string;
}

export const deepai: ProviderAdapter<StatusState, DeepaiSetup> = {
  id: 'deepai',
  createState: () => ({}),
  prepare: ({ dataDir }) => ({ extension: writePiExtension(dataDir, 'deepai'), dataDir, launcher: writeDeepaiLauncher(dataDir) }),
  launch({ h, args, prompt, resumeSessionId, setup }) {
    const { info } = h;
    const sessionDir = path.join(setup.dataDir, 'deepai-sessions', info.id);
    mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
    h.state.error = false;
    return {
      // Nobody's pick spends Theos by accident: the app's own default can be a premier model, and
      // fifteen Theos a reply is not what an empty model field means.
      args: piArgs(args, { extension: setup.extension, sessionDir, sessionId: resumeSessionId, model: info.model ?? deepaiFreeModel(), effort: info.effort, prompt }),
      rotateToken: true,
      // Its models are served by the running app, so a machine without it can't run one at all.
      finishEnv() {
        if (!setup.launcher && !deepaiApp()) {
          throw new Error('DeepAI Code is not installed on this machine: install it, or point DEEPAI_APP at its app folder, then press R here');
        }
      },
    };
  },
  bootHint: 'Open the terminal: sign in to DeepAI Code there',
  hook: {
    strictJson: true,
    handle(h, _event, payload) {
      const report = normalizePiHook(payload);
      return !!report && reduceStatus(h, report, { onReport: () => (h.bootBlocked = false), idleOnStart: true });
    },
  },
};
