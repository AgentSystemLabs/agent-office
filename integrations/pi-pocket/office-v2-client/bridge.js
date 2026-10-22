// This bridge exposes only this module's public routes and native Pocket navigation.
export function validRequest(event, frameWindow, origin, channel) {
  const m = event.data;
  if (event.source !== frameWindow || event.origin !== origin || !m || typeof m !== 'object') return false;
  if (m.type !== 'office-v2:request' || m.channel !== channel) return false;
  if (typeof m.id !== 'string' || !/^[a-zA-Z0-9._:-]{1,120}$/.test(m.id)) return false;
  if (!['connect', 'poll', 'move', 'chat', 'hire', 'open', 'dismiss', 'customize'].includes(m.op)) return false;
  if (m.payload !== undefined && (!m.payload || typeof m.payload !== 'object' || Array.isArray(m.payload))) return false;
  try { return JSON.stringify(m).length <= 32000; } catch { return false; }
}

export function createBridge({ pocket, source, clientId, signal, onSnapshot = () => {}, customize = () => {} }) {
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
      case 'move':
        presence = { ...presence, ...(payload.position ?? payload) };
        return state();
      case 'hire':
        return pocket.api(`hire/${source}`, { deskId: payload.deskId, prompt: payload.prompt, requestId: payload.key, clientId }, { signal }).then(observe);
      case 'chat':
        return pocket.api(`state/${source}`, { action: 'chat', text: payload.text, requestId: payload.key ?? crypto.randomUUID(), clientId }, { signal }).then(observe);
      case 'dismiss':
        return pocket.api(`dismiss/${source}`, { workerId: payload.workerId, clientId }, { signal }).then(observe);
      case 'open': {
        const snapshot = await state(false);
        ensureOpen();
        const binding = snapshot.bindings?.find((b) => b.workerId === payload.workerId);
        if (!binding) throw new Error('This desk has no session you can open. Refresh the office.');
        ensureOpen();
        pocket.openConversation(binding.conversationId);
        if (payload.prompt) {
          // Native navigation is asynchronous. Never put a draft into the old session.
          const deadline = Date.now() + 5000;
          while (pocket.conversationId() !== binding.conversationId) {
            if (signal.aborted || Date.now() > deadline) throw new Error('Open the worker conversation before adding a draft. Nothing was sent.');
            await new Promise((r) => setTimeout(r, 30));
          }
          if (typeof payload.prompt !== 'string' || payload.prompt.length > 20000) throw new Error('The task draft is too long. Nothing was sent.');
          ensureOpen();
          pocket.insertText(payload.prompt);
          pocket.notify('info', 'Task draft added to the worker conversation. Review and send it there.');
        }
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
