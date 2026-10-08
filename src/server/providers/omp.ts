// OMP: an extension the office writes and loads with --extension (see ../omp.ts), so the person's own
// OMP login, settings, packages and extensions stay as they are. It reports on /hooks/omp in the same
// statuses as OpenCode's plugin. Its sessions are OMP's own, in the person's OMP store: the conversation
// a desk starts is the one a terminal `omp --resume` opens, and its spend is read off the same session
// records `omp stats` sums (see omp-usage.ts) rather than metered separately by the office.
import path from 'node:path';
import { normalizeOmpHook, ompArgs, writeOmpExtension } from '../omp.js';
import { OmpUsageReader, ompAgentDir, ompSessionFile, ompSessionFileIn } from '../omp-usage.js';
import { reduceStatus, type StatusState } from './opencode.js';
import type { ProviderAdapter } from './types.js';

interface OmpSetup {
  /** The office's extension. */
  extension: string;
  /** The floor's data dir, where a desk's own session folder lived before sessions moved into OMP's. */
  dataDir: string;
}

interface OmpState extends StatusState {
  /** Its session records, followed as the file grows. */
  usage: OmpUsageReader;
  /** Where the person's OMP keeps its sessions, from the environment the worker starts in. */
  sessions?: string;
  /** A desk folder of its own, when the session being resumed still lives there. */
  own?: string;
  /** The session file being read, and the session it belongs to. */
  file?: { id: string; path: string };
}

export const omp: ProviderAdapter<OmpState, OmpSetup> = {
  id: 'omp',
  createState: () => ({ usage: new OmpUsageReader() }),
  prepare: ({ dataDir }) => ({ extension: writeOmpExtension(dataDir), dataDir }),
  launch({ h, args, prompt, resumeSessionId, setup }) {
    const { info, state } = h;
    // A desk that already kept a session folder of its own (started before sessions moved into the
    // person's OMP store) carries on there, so its conversation isn't lost. Everything else names no
    // folder at all: OMP writes the session into its own store, under the folder it was run in, which
    // is what makes the office's conversations the same ones `omp --resume` finds.
    const own = path.join(setup.dataDir, 'omp-sessions', info.id);
    state.own = resumeSessionId && ompSessionFileIn(own, resumeSessionId) ? own : undefined;
    state.file = undefined;
    state.error = false;
    // --resume carries on this desk's own conversation; OMP writes a session file as it starts.
    return { args: ompArgs(args, { extension: setup.extension, sessionDir: state.own, sessionId: resumeSessionId, model: info.model, effort: info.effort, prompt }), rotateToken: true };
  },
  bootHint: 'Open the terminal: complete OMP login or project setup',
  // Resuming a conversation OMP no longer has ("Session ... not found") exits before it ever starts.
  freshIfResumeFails: true,
  hook: {
    strictJson: true,
    handle(h, _event, payload) {
      const report = normalizeOmpHook(payload);
      // OMP is up once its extension reports, so the desk isn't stuck at start any more. A session
      // starting (a new one, or one resumed) leaves it ready for a prompt.
      return !!report && reduceStatus(h, report, {
        onReport: () => {
          h.bootBlocked = false;
          h.scheduleScan();
        },
        idleOnStart: true,
      });
    },
  },
  usage: {
    // Its numbers are what it reported, and they come off a file OMP owns: kept in workers.json,
    // read again when its process ends, and read from scratch after a restart (the totals are
    // replaced, never added to, so nothing is counted twice).
    persisted: true,
    scanOnExit: true,
    locate(h, cwd, env) {
      h.state.sessions = ompAgentDir(cwd, env);
    },
    scan(h) {
      const { info, state } = h;
      if (!info.sessionId) return;
      const root = state.own ?? (state.sessions ? path.join(state.sessions, 'sessions') : undefined);
      if (!root) return;
      let target: string | undefined;
      if (state.own) {
        target = ompSessionFileIn(state.own, info.sessionId);
      } else {
        if (state.file?.id !== info.sessionId) {
          const found = ompSessionFile(root, info.sessionId);
          state.file = found ? { id: info.sessionId, path: found } : undefined;
        }
        target = state.file?.path;
      }
      if (!target) return;
      const usage = state.usage.read(target, root);
      if (usage && JSON.stringify(usage) !== JSON.stringify(info.usage)) {
        info.usage = usage;
        h.emit();
        h.persist();
      }
    },
  },
};
