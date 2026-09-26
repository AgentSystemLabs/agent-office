import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type OpenCodeHookStatus = 'starting' | 'working' | 'needs_input' | 'done';

/** Compact, stable bridge payload sent by the generated OpenCode plugin. */
export interface OpenCodeHookEvent {
  type: 'session' | 'prompt' | 'tool' | 'permission' | 'question' | 'error';
  sessionId: string;
  status: OpenCodeHookStatus;
  prompt?: string;
  tool?: string;
  detail?: string;
}

/** Merge the per-process plugin into inline OpenCode config without touching user config files. */
export function mergeOpenCodeConfigContent(existing: string | undefined, plugin: string): string {
  let config: Record<string, unknown> = {};
  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      config = { ...(parsed as Record<string, unknown>) };
      if (config.plugin !== undefined && !Array.isArray(config.plugin)) throw new Error('plugin is not an array');
    } catch {
      throw new Error('OPENCODE_CONFIG_CONTENT must be valid JSON');
    }
  }
  const plugins = Array.isArray(config.plugin) ? [...config.plugin] : [];
  if (!plugins.includes(plugin)) plugins.push(plugin);
  config.plugin = plugins;
  return JSON.stringify(config);
}

/** Write the self-contained plugin used for every OpenCode worker process. */
export function writeOpenCodePlugin(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'agent-office-opencode.mjs');
  writeFileSync(file, OPENCODE_PLUGIN_SOURCE, { mode: 0o600 });
  return file;
}

export function openCodePluginSpecifier(file: string): string {
  return pathToFileURL(file).href;
}

/** No imports: OpenCode loads this module from the office data directory in packaged installs. */
export const OPENCODE_PLUGIN_SOURCE = String.raw`export default async function AgentOfficeOpenCodePlugin({ client } = {}) {
  const url = process.env.AGENT_OFFICE_HOOK_URL;
  const token = process.env.AGENT_OFFICE_HOOK_TOKEN;
  const worker = process.env.AGENT_OFFICE_WORKER_ID;
  if (!url || !token || !worker) return {};
  let rootSession = process.env.AGENT_OFFICE_SESSION_ID || undefined;
  const children = new Set();
  const pending = new Set();
  let queued = Promise.resolve();

  // SDK lookups, session selection and delivery share one order. A slow selection cannot let
  // a later idle event overtake its prompt, and a stalled office cannot stall the agent forever.
  function enqueue(job) {
    queued = queued.then(job).catch(() => {});
    return queued;
  }
  async function send(value) {
    if (!value) return;
    try {
      await fetch(url + "/hooks/opencode?worker=" + encodeURIComponent(worker), {
        method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify(value),
        signal: AbortSignal.timeout(2500),
      });
    } catch {}
  }
  function detail(value) {
    return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : undefined;
  }
  function select(id) {
    rootSession = id;
    pending.clear();
    return { type: "session", sessionId: id, status: "starting" };
  }
  async function selectExisting(id) {
    if (id === rootSession) return true;
    if (children.has(id) || !client || !client.session) return false;
    try {
      const result = await client.session.get({ path: { id }, signal: AbortSignal.timeout(2500) });
      const info = result.data;
      if (!info || info.id !== id) return false;
      if (info.parentID) { children.add(id); return false; }
      await send(select(id));
      return true;
    } catch { return false; }
  }
  function compact(event) {
    if (!event || typeof event.type !== "string") return;
    const p = event.properties || {};
    const info = p.info || {};
    const id = p.sessionID || info.id;
    if (event.type === "session.created") {
      if (typeof id !== "string") return;
      if (info.parentID) { children.add(id); return; }
      return select(id);
    }
    if (!id || id !== rootSession || children.has(id)) return;
    const base = { type: "session", sessionId: id };
    const working = () => ({ ...base, status: pending.size ? "needs_input" : "working" });
    if (event.type === "session.status" && (p.status?.type === "busy" || p.status?.type === "retry")) return working();
    if (event.type === "session.idle" || (event.type === "session.status" && p.status?.type === "idle")) {
      pending.clear();
      return { ...base, status: "done" };
    }
    if (event.type === "session.error") {
      const err = p.error || {};
      return { ...base, type: "error", status: "needs_input", detail: detail(err.data?.message) || detail(err.message) || detail(err.name) };
    }
    if (event.type === "permission.asked" || event.type === "question.asked") {
      const kind = event.type.split(".")[0];
      pending.add(kind + ":" + p.id);
      const q = Array.isArray(p.questions) ? p.questions[0] : undefined;
      return { ...base, type: kind, status: "needs_input", detail: detail(q?.question || q?.header || p.title || p.permission) };
    }
    if (["permission.replied", "question.replied", "question.rejected"].includes(event.type)) {
      pending.delete(event.type.split(".")[0] + ":" + p.requestID);
      return working();
    }
  }
  return {
    event: ({ event }) => enqueue(() => send(compact(event))),
    "chat.message": (input, output) => enqueue(async () => {
      if (typeof input.sessionID !== "string" || !await selectExisting(input.sessionID)) return;
      const parts = output && Array.isArray(output.parts) ? output.parts : [];
      const prompt = parts.filter((part) => part && part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n").trim().slice(0, 20000);
      await send({ type: "prompt", sessionId: input.sessionID, status: "working", ...(prompt ? { prompt } : {}) });
    }),
    "tool.execute.before": (input) => enqueue(() => {
      if (input.sessionID === rootSession && !children.has(input.sessionID)) {
        return send({ type: "tool", sessionId: input.sessionID, tool: input.tool, status: pending.size ? "needs_input" : "working" });
      }
    }),
  };
}
`;
