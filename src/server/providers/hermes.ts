// Hermes Agent: its own CLI (`hermes chat`), the person's own login, config and plugins, and a
// plugin the office adds to report its lifecycle on /hooks/hermes (see ../hermes.ts). Its spend isn't
// metered by the office.
import { hermesArgs, hermesHome, hermesHookFile, normalizeHermesHook, writeHermesHookFile, writeHermesPlugin } from '../hermes.js';
import { reduceStatus, type StatusState } from './opencode.js';
import type { ProviderAdapter } from './types.js';

interface HermesSetup {
  /** Where the office's plugin went, when Hermes is installed on this machine. */
  pluginDir?: string;
  /** Where each run's hook file goes (see ../hermes.ts). */
  dataDir: string;
}

export const hermes: ProviderAdapter<StatusState, HermesSetup> = {
  id: 'hermes',
  // A worker runs its own session: never inherit the session the office itself may be running in.
  scrubEnv: ['HERMES_SESSION_ID', 'HERMES_SESSION_KEY', 'HERMES_SESSION_PLATFORM', 'HERMES_GATEWAY_SESSION', 'HERMES_SINGLE_QUERY_SESSION', 'HERMES_CRON_SESSION'],
  createState: () => ({}),
  prepare: ({ dataDir }) => ({ pluginDir: writeHermesPlugin(hermesHome()), dataDir }),
  launch({ h, args, prompt, resumeSessionId, setup }) {
    const { info } = h;
    h.state.error = false;
    // Hermes' gateway runs the plugin, not this process: its path goes in as the session's client env.
    const hookFile = hermesHookFile(setup.dataDir, info.id);
    return {
      args: hermesArgs(args, { sessionId: resumeSessionId, model: info.model, effort: info.effort, prompt }),
      env: { AGENT_OFFICE_HOOK_FILE: hookFile },
      rotateToken: true,
      finishEnv: (env) => writeHermesHookFile(hookFile, env),
    };
  },
  bootHint: 'Open the terminal: finish Hermes setup, enable the office plugin with `hermes plugins enable agent-office`, and add AGENT_OFFICE_HOOK_FILE under terminal.client_env_passthrough in Hermes\' config',
  titleNoise: /^hermes( agent)?$/i,
  freshIfResumeFails: true,
  hook: {
    strictJson: true,
    handle(h, _event, payload) {
      const report = normalizeHermesHook(payload);
      // Hermes is up once its plugin reports, so the desk isn't stuck at start any more. A session
      // starting (a new one, or one resumed) leaves it ready for a prompt.
      return !!report && reduceStatus(h, report, { onReport: () => (h.bootBlocked = false), idleOnStart: true });
    },
  },
};
