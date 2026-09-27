import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { NotifyState, WebhookKind, WorkerInfo, WorkerStatus } from '../shared/protocol.js';
import { alertDetail } from '../shared/status.js';

/** A worker has to stay put this long before the channel hears about it, so a flicker never posts. */
const SETTLE_MS = 5_000;
/** Slack and Discord both throttle a webhook to about one message a second. */
const GAP_MS = 1_100;
const TIMEOUT_MS = 10_000;
/** More than this many posts waiting means a stuck channel; drop the extras instead of piling up. */
const MAX_BACKLOG = 20;

type Alert = Extract<WorkerStatus, 'needs_input' | 'done'>;

interface Saved {
  url: string;
  by: string;
  at: number;
}

export function webhookKind(url: URL): WebhookKind {
  if (url.hostname === 'hooks.slack.com') return 'slack';
  if (/^(ptb\.|canary\.)?discord(app)?\.com$/.test(url.hostname) && url.pathname.startsWith('/api/webhooks/')) return 'discord';
  return 'other';
}

/** Where the webhook goes, without the secret part of its path: "hooks.slack.com/…/x7Qe". */
function hint(url: URL): string {
  const tail = url.pathname.replace(/\/+$/, '').slice(-4);
  return `${url.host}/…${tail}`;
}

/** Slack reads <, > and & as markup; escaping them keeps a worker's text from pinging <!channel>. */
const slackEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * The office's Slack / Discord webhook. When an agent worker starts waiting on input or finishes its
 * turn, and is still that way a few seconds later with nobody at its terminal, the channel gets a
 * line about it. Set from ⚙️ Settings (or --webhook) and kept in .agent-office/webhook.json.
 */
export class Webhook {
  private saved?: Saved;
  private error?: string;
  private lastSentAt?: number;
  private path: string;
  /** Each worker's latest state, and the alert waiting out its settle time. */
  private latest = new Map<string, WorkerInfo>();
  private pending = new Map<string, { status: Alert; timer: NodeJS.Timeout }>();
  private chain: Promise<unknown> = Promise.resolve();
  private backlog = 0;

  constructor(
    dataDir: string,
    /** The project a worker works on (the floor it's on), or the office's name without one. */
    private project: (workerId?: string) => string,
    private onState: (state: NotifyState) => void,
  ) {
    this.path = path.join(dataDir, 'webhook.json');
    this.restore();
  }

  state(): NotifyState {
    if (!this.saved) return {};
    const url = new URL(this.saved.url);
    return { webhook: { kind: webhookKind(url), hint: hint(url), by: this.saved.by, at: this.saved.at }, error: this.error, lastSentAt: this.lastSentAt };
  }

  /** Point the office at a new webhook ('' removes it). Returns why it can't, if it can't. */
  set(raw: string, by: string): string | undefined {
    const text = raw.trim();
    if (!text) {
      this.saved = undefined;
    } else {
      let url: URL;
      try {
        url = new URL(text);
      } catch {
        return "That isn't a link. Paste the webhook URL from Slack or Discord.";
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'The webhook has to be an http(s) link';
      if (text.length > 2000) return 'That link is too long';
      this.saved = { url: url.toString(), by, at: Date.now() };
    }
    this.error = undefined;
    this.lastSentAt = undefined;
    this.persist();
    this.onState(this.state());
    return undefined;
  }

  /** Called with every worker update. */
  onWorker(w: WorkerInfo) {
    const prev = this.latest.get(w.id);
    this.latest.set(w.id, w);
    if (w.kind !== 'agent' || !prev || prev.status === w.status) return;
    this.cancel(w.id);
    if (w.status !== 'needs_input' && w.status !== 'done') return;
    const status = w.status;
    const timer = setTimeout(() => {
      this.pending.delete(w.id);
      const cur = this.latest.get(w.id);
      // Someone opened its terminal (or it moved on) meanwhile: they've got it.
      if (!cur || cur.status !== status || cur.acked || cur.viewers.length) return;
      void this.alert(cur, status);
    }, SETTLE_MS);
    timer.unref();
    this.pending.set(w.id, { status, timer });
  }

  onWorkerGone(id: string) {
    this.cancel(id);
    this.latest.delete(id);
  }

  /** Posts a test message. Resolves to an error message if it didn't get through. */
  test(by: string): Promise<string | undefined> {
    if (!this.saved) return Promise.resolve('No webhook is set');
    return this.post({ kind: 'test', title: `🔔 ${by} connected ${this.project()} to this channel`, detail: 'Workers that need input or finish will show up here.' });
  }

  stop() {
    for (const id of [...this.pending.keys()]) this.cancel(id);
  }

  private cancel(id: string) {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
  }

  private alert(w: WorkerInfo, status: Alert) {
    const what = status === 'needs_input' ? `🙋 ${w.name} needs input` : `✅ ${w.name} is done`;
    const task = w.task?.name ? ` — ${oneLine(w.task.name, 80)}` : '';
    const detail = alertDetail(w);
    return this.post({ kind: status, title: `${what} in ${this.project(w.id)}${task}`, detail: detail ? oneLine(detail, 300) : undefined, worker: w });
  }

  private post(msg: { kind: Alert | 'test'; title: string; detail?: string; worker?: WorkerInfo }): Promise<string | undefined> {
    if (!this.saved) return Promise.resolve('No webhook is set');
    if (this.backlog >= MAX_BACKLOG) return Promise.resolve('Too many messages are waiting to be posted');
    const saved = this.saved;
    this.backlog++;
    const run = this.chain.then(async () => {
      try {
        return await this.send(saved, msg);
      } finally {
        this.backlog--;
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
    });
    this.chain = run.catch(() => {});
    return run;
  }

  private async send(saved: Saved, msg: { kind: Alert | 'test'; title: string; detail?: string; worker?: WorkerInfo }): Promise<string | undefined> {
    const url = new URL(saved.url);
    const kind = webhookKind(url);
    let body: unknown;
    if (kind === 'slack') {
      body = { text: `*${slackEscape(msg.title)}*${msg.detail ? `\n>${slackEscape(msg.detail)}` : ''}` };
    } else if (kind === 'discord') {
      // No @everyone or role pings, whatever a worker's text says.
      body = { content: `**${msg.title}**${msg.detail ? `\n> ${msg.detail}` : ''}`, username: 'Agent Office', allowed_mentions: { parse: [] } };
    } else {
      const w = msg.worker;
      body = {
        text: msg.detail ? `${msg.title}\n${msg.detail}` : msg.title,
        event: msg.kind,
        project: this.project(w?.id),
        worker: w && { id: w.id, name: w.name, desk: w.deskId, status: w.status, task: w.task?.name, branch: w.worktree?.branch },
      };
    }
    let error: string | undefined;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const why = oneLine((await res.text().catch(() => '')) || res.statusText, 120);
        error = `The webhook answered ${res.status}${why ? `: ${why}` : ''}`;
      }
    } catch (err) {
      const e = err as Error;
      error = e.name === 'TimeoutError' ? 'The webhook did not answer in time' : `Couldn't reach the webhook: ${(e.cause as Error | undefined)?.message ?? e.message}`;
    }
    // The link was changed while this was on its way; its outcome says nothing about the new one.
    if (this.saved !== saved) return error;
    if (error) console.error(`agent-office: webhook: ${error}`);
    if (error !== this.error || !error) {
      this.error = error;
      if (!error) this.lastSentAt = Date.now();
      this.onState(this.state());
    }
    return error;
  }

  private persist() {
    try {
      writeFileSync(this.path, JSON.stringify(this.saved ?? {}, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }

  private restore() {
    if (!existsSync(this.path)) return;
    try {
      const s = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<Saved>;
      if (typeof s.url === 'string' && URL.canParse(s.url)) this.saved = { url: s.url, by: typeof s.by === 'string' ? s.by : '?', at: typeof s.at === 'number' ? s.at : Date.now() };
    } catch {
      // a broken file just means no webhook
    }
  }
}
