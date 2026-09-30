// A worker that runs over ACP rather than in a terminal (DeepSeek Harness, see ProviderAdapter.transport):
// the office holds the connection and draws what it says into the worker's terminal itself.
import { DshSession, terminalSafe } from '../dsh.js';
import type { HeadlessTerminal } from './terminal.js';
import type { Worker, WorkerContext } from './types.js';
import { truncate } from './util.js';

/**
 * Starts (or resumes) a DeepSeek Harness worker over ACP. The session renders its transcript into
 * the worker's terminal and reports status, acted-out actions, usage and its session id; the
 * office answers permission requests from whoever is typing (see dsh.ts).
 */
export function launchAcp(ctx: WorkerContext, w: Worker, term: HeadlessTerminal, options: { file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; resumeSessionId?: string; prompt?: string }) {
  const { info } = w;
  const session = new DshSession(
    {
      file: options.file,
      args: options.args,
      cwd: options.cwd,
      env: options.env,
      model: info.model,
      effort: info.effort,
      resumeSessionId: options.resumeSessionId,
      firstPrompt: options.prompt,
    },
    {
      output: (data) => {
        if (w.dsh !== session) return;
        term.write(data);
        w.screenDirty = true;
        w.unsaved = true;
        if (w.viewers.size) ctx.events.data(info.id, data, [...w.viewers.keys()]);
      },
      status: (status) => {
        if (w.dsh === session) ctx.setStatus(w, status);
      },
      action: (action) => {
        if (w.dsh !== session || info.action === action) return;
        info.action = action;
        ctx.emit(w);
      },
      usage: (usage) => {
        if (w.dsh !== session) return;
        info.usage = usage;
        ctx.emit(w);
        ctx.persist();
      },
      session: (sessionId) => {
        if (w.dsh !== session || info.sessionId === sessionId) return;
        info.sessionId = sessionId;
        ctx.emit(w);
        ctx.persist();
      },
      prompted: (text) => {
        // A line typed into the terminal: there are no hooks for DSH, so the card learns from here.
        if (w.dsh !== session) return;
        ctx.notePrompt(w, text);
        ctx.emit(w);
      },
      exit: (code, error, quiet) => acpExited(ctx, w, session, term, code, error, quiet),
    },
  );
  w.dsh = session;
  session.start();
}

/** A DeepSeek Harness child ended: while the office is up, its desk says so and R resumes it. */
function acpExited(ctx: WorkerContext, w: Worker, session: DshSession, term: HeadlessTerminal, code: number | null, error: string | undefined, quiet: boolean) {
  const { info } = w;
  if (w.dsh !== session || ctx.workers.get(info.id) !== w) return; // sent home: stay quiet
  w.dsh = undefined;
  // The office is going down: the next office marks this worker offline and resumes it, so its
  // status must stay as it was (see the restart difference in docs/dsh-acp-integration.md).
  if (quiet || ctx.closing) return;
  const note = error ? `\r\n\x1b[31m[DeepSeek Harness: ${terminalSafe(truncate(error, 300)).replace(/\n/g, ' ')}]\x1b[0m\r\n` : '';
  if (note) {
    term.write(note);
    if (w.viewers.size) ctx.events.data(info.id, note, [...w.viewers.keys()]);
  }
  // It never got as far as a session: most often `dsh` is missing, or the profile will not boot.
  if (error && !info.sessionId) ctx.events.toast(`Could not start ${ctx.command(info)}: ${truncate(error, 200)}`, 'error');
  info.exitCode = code ?? -1;
  info.status = 'exited';
  const hint = info.sessionId ? ' — press R to resume' : '';
  const msg = `\r\n\x1b[2m[${info.name} exited with code ${code ?? -1}${hint}]\x1b[0m\r\n`;
  term.write(msg);
  if (w.viewers.size) ctx.events.data(info.id, msg, [...w.viewers.keys()]);
  w.screenDirty = true;
  w.unsaved = true;
  ctx.emit(w);
  ctx.persist();
}
