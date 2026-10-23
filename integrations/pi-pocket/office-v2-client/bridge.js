import { uuid } from './uuid.js';
// This bridge exposes only this module's public routes and scoped native conversation inspection.
export function validRequest(event, frameWindow, origin, channel) {
  const m = event.data;
  if (event.source !== frameWindow || event.origin !== origin || !m || typeof m !== 'object') return false;
  if (m.type !== 'office-v2:request' || m.channel !== channel) return false;
  if (typeof m.id !== 'string' || !/^[a-zA-Z0-9._:-]{1,120}$/.test(m.id)) return false;
  if (!['connect', 'poll', 'move', 'chat', 'hire', 'open', 'dismiss', 'customize', 'workspace', 'presence', 'floors', 'switch'].includes(m.op)) return false;
  if (m.payload !== undefined && (!m.payload || typeof m.payload !== 'object' || Array.isArray(m.payload))) return false;
  try { return JSON.stringify(m).length <= 32000; } catch { return false; }
}

export function createBridge({ pocket, source, clientId, signal, onSnapshot = () => {}, customize = () => {}, workspace = () => {}, inspect, switchFloor }) {
  let presence = {};
  const ensureOpen = () => { if (signal.aborted) throw new Error('The office is closed.'); };
  const observe = (snapshot) => { ensureOpen(); onSnapshot(snapshot); return snapshot; };
  const state = (heartbeat = true) => {
    const query = new URLSearchParams({ clientId });
    if (heartbeat) query.set('presence', JSON.stringify(presence));
    return pocket.api(`state/${source}?${query}`, undefined, { signal }).then(observe);
  };
  return async (op, payload = {}) => {
    if (signal.aborted) throw new Error('The office is closed.');
    switch (op) {
      case 'connect':
        presence = { ...presence, ...(payload.profile ?? payload) };
        return state();
      case 'poll': return state();
      case 'customize': customize(); return { opened: true };
      case 'workspace': workspace(); return { opened: true };
      case 'floors': return pocket.api('floors', undefined, { signal });
      case 'switch': {
        if (!Number.isSafeInteger(payload.source) || payload.source < 1 || typeof switchFloor !== 'function') throw new Error('Select an available chat floor.');
        await switchFloor(payload.source);
        ensureOpen();
        return { switching: true, source: payload.source };
      }
      case 'presence':
        return pocket.api(`presence/${source}`, { clientId, action: payload.action }, { signal }).then(observe);
      case 'move':
        presence = { ...presence, ...(payload.position ?? payload) };
        return state();
      case 'hire':
        return pocket.api(`hire/${source}`, { deskId: payload.deskId, prompt: payload.prompt, requestId: payload.key, clientId }, { signal }).then(observe);
      case 'chat':
        return pocket.api(`state/${source}`, { action: 'chat', text: payload.text, requestId: payload.key ?? uuid(), clientId }, { signal }).then(observe);
      case 'dismiss':
        return pocket.api(`dismiss/${source}`, { workerId: payload.workerId, clientId }, { signal }).then(observe);
      case 'open': {
        if (typeof payload.workerId !== 'string' || !payload.workerId || payload.workerId.length > 120) throw new Error('Select a worker or the master desk.');
        const snapshot = await state(false);
        ensureOpen();
        const binding = snapshot.master?.workerId === payload.workerId
          ? { conversationId: snapshot.source }
          : snapshot.bindings?.find((b) => b.workerId === payload.workerId);
        if (!binding) throw new Error('This desk has no session you can open. Refresh the office.');
        if (payload.prompt !== undefined && (typeof payload.prompt !== 'string' || payload.prompt.length > 20000)) throw new Error('The task draft is too long. Nothing was sent.');
        if (typeof inspect !== 'function') throw new Error('The Pocket conversation-view SDK update is required to inspect this worker.');
        const master = snapshot.master?.workerId === payload.workerId;
        const worker = snapshot.workers?.find((item) => item.id === payload.workerId);
        ensureOpen();
        await inspect({ source, workerId: payload.workerId, conversationId: binding.conversationId,
          title: master ? snapshot.master.title : worker?.name ?? 'Worker conversation',
          master, draft: payload.prompt });
        ensureOpen();
        return { opened: true, draft: !!payload.prompt, sent: false };
      }
      default: throw new Error('This action is not supported by the Pocket runtime.');
    }
  };
}

export function listenToFrame({ frame, origin, channel, handle, onError = () => {} }) {
  const replies = new Map();
  let closed = false;
  const listener = async (event) => {
    if (closed || !validRequest(event, frame.contentWindow, origin, channel)) return;
    const { id, op, payload } = event.data;
    const fingerprint = JSON.stringify({ op, payload });
    const send = (body) => {
      if (!closed) frame.contentWindow?.postMessage({ type: 'office-v2:reply', channel, id, ...body }, origin);
    };
    const previous = replies.get(id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return send({ error: 'Request id was reused for a different action.' });
      return send(await previous.reply);
    }
    if (replies.size >= 128) {
      const settled = [...replies].find(([, entry]) => entry.settled);
      if (settled) replies.delete(settled[0]);
      else return send({ error: 'Too many pending office requests.' });
    }
    const entry = { fingerprint, settled: false, reply: null };
    entry.reply = Promise.resolve().then(() => handle(op, payload)).then(
      (result) => ({ result }),
      (error) => { onError(error.message); return { error: error.message || 'The office request failed.' }; },
    ).finally(() => { entry.settled = true; });
    replies.set(id, entry);
    send(await entry.reply);
  };
  window.addEventListener('message', listener);
  return () => { closed = true; replies.clear(); window.removeEventListener('message', listener); };
}
