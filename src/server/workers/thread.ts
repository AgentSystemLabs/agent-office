import { ThreadSession } from '../deepai-thread.js';
import type { HeadlessTerminal } from './terminal.js';
import type { Worker, WorkerContext } from './types.js';

export function launchThread(ctx: WorkerContext, w: Worker, term: HeadlessTerminal, options: { cwd: string; prompt?: string; resumeSessionId?: string; setup: { dataDir: string }; model?: string; effort?: string; title: string }) {
  const { info } = w;
  const session = new ThreadSession({ dataDir: options.setup.dataDir, cwd: options.cwd, workspaceRoot: ctx.dir, model: options.model, effort: options.effort, resumeThreadId: options.resumeSessionId, firstPrompt: options.prompt, title: options.title }, {
    output(data) {
      if (w.dsh !== session) return;
      term.write(data); w.screenDirty = true; w.unsaved = true;
      if (w.viewers.size) ctx.events.data(info.id, data, [...w.viewers.keys()]);
    },
    status(status) { if (w.dsh === session) ctx.setStatus(w, status); },
    usage(usage) { if (w.dsh !== session) return; info.usage = usage; ctx.emit(w); ctx.persist(); },
    session(id) { if (w.dsh !== session) return; info.sessionId = id; ctx.emit(w); ctx.persist(); },
    prompted(text) { if (w.dsh !== session) return; ctx.notePrompt(w, text); ctx.emit(w); },
    exit(code, error, quiet) { threadExited(ctx, w, session, term, code, error, quiet ?? false); },
  });
  w.dsh = session;
  ctx.emit(w);
  ctx.persist();
  void session.start();
}

function threadExited(ctx: WorkerContext, w: Worker, session: ThreadSession, term: HeadlessTerminal, code: number | null, error: string | undefined, quiet: boolean) {
  const { info } = w;
  if (w.dsh !== session || ctx.workers.get(info.id) !== w) return;
  w.dsh = undefined;
  if (quiet || ctx.closing) return;
  const needsPairing = !!error && /pair DeepAI Code first/i.test(error);
  if (error && !needsPairing) ctx.events.toast(`Could not start ${info.name}: ${error.slice(0, 200)}`, 'error');
  if (needsPairing) {
    info.exitCode = undefined;
    ctx.setStatus(w, 'needs_input');
    const message = '\r\n\x1b[33m[Pair DeepAI Code first, then press R to retry]\x1b[0m\r\n';
    term.write(message); if (w.viewers.size) ctx.events.data(info.id, message, [...w.viewers.keys()]);
    w.screenDirty = true; w.unsaved = true; ctx.persist();
    return;
  }
  info.exitCode = code ?? -1; info.status = 'exited';
  const message = `\r\n\x1b[2m[${info.name} exited with code ${code ?? -1}${info.sessionId ? ' — press R to resume' : ''}]\x1b[0m\r\n`;
  term.write(message); if (w.viewers.size) ctx.events.data(info.id, message, [...w.viewers.keys()]);
  w.screenDirty = true; w.unsaved = true; ctx.emit(w); ctx.persist();
}
