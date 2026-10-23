import { uuid } from './uuid.js';
const prefix = (personId) => `x.office-v2.${encodeURIComponent(personId)}.`;
export function recentWorkspaces(personId, storage) {
  try {
    storage ??= globalThis.localStorage;
    const ids = JSON.parse(storage.getItem(`${prefix(personId)}workspaces`) ?? '[]');
    return Array.isArray(ids) ? [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 8) : [];
  } catch { return []; }
}
export function rememberWorkspace(personId, source, storage) {
  if (!Number.isSafeInteger(source) || source < 1) return;
  try {
    storage ??= globalThis.localStorage;
    storage.setItem(`${prefix(personId)}workspace`, String(source));
    storage.setItem(`${prefix(personId)}workspaces`, JSON.stringify([source, ...recentWorkspaces(personId, storage).filter((id) => id !== source)].slice(0, 8)));
  } catch { /* Account-owned browser history is optional and does not grant access. */ }
}
export function workspaceFromLink(value, origin) {
  const input = value.trim();
  if (/^#?[1-9]\d*$/.test(input)) {
    const id = Number(input.replace(/^#/, ''));
    if (Number.isSafeInteger(id)) return id;
  }
  try {
    const url = new URL(input, origin);
    const match = url.pathname.match(/^\/s\/([1-9]\d*)\/?$/);
    if (url.origin === origin && !url.username && !url.password && match && Number.isSafeInteger(Number(match[1]))) return Number(match[1]);
  } catch { /* Report one clear input error below. */ }
  throw new Error('Paste a chat link from this Pocket app, such as /s/123, or a conversation number.');
}

export function workspaceView(pocket, changed) {
  const { html, useState, useRef, useEffect } = pocket;
  return function Workspace({ close, source, personId }) {
    const openChat = pocket.conversationId();
    const [rooms, setRooms] = useState([]);
    const [link, setLink] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const clientId = useRef(uuid());
    const lifetime = useRef(null);
    const ids = [...new Set([openChat, source, ...recentWorkspaces(personId)].filter((id) => Number.isSafeInteger(id) && id > 0))];
    const load = (id, signal) => pocket.api(`state/${id}?${new URLSearchParams({ clientId: clientId.current })}`, undefined, { signal });
    useEffect(() => {
      const stop = new AbortController();
      lifetime.current = stop;
      Promise.all(ids.map(async (id) => {
        try { const room = await load(id, stop.signal); return { id, title: room.title, model: room.model }; }
        catch { return { id, unavailable: true }; }
      })).then((items) => { if (!stop.signal.aborted) setRooms(items); });
      return () => stop.abort();
    }, []);
    async function choose(id) {
      const stop = lifetime.current;
      if (!stop || stop.signal.aborted) return;
      setBusy(true); setError('');
      try {
        // Recheck access at selection time. No heartbeat, agent start, or conversation mutation.
        const room = await load(id, stop.signal);
        if (stop.signal.aborted) return;
        rememberWorkspace(personId, room.source);
        changed('workspace', room);
        pocket.openConversation(room.source);
        close();
      } catch (failure) { if (!stop.signal.aborted) setError(failure.message); }
      finally { if (!stop.signal.aborted) setBusy(false); }
    }
    function paste() {
      try { void choose(workspaceFromLink(link, location.origin)); }
      catch (failure) { setError(failure.message); }
    }
    return html`<section class="office-v2-avatar">
      <p>Choose the chat whose office you want to join. Open a chat in Pocket, paste its link, or choose a recent workspace.</p>
      <p class="muted small">People and desks belong to each workspace. Switching joins that room; it does not move teammates or agents. New agents inherit the selected root chat’s model and settings. Linked agent chats cannot hire other agents.</p>
      <label>Chat link or number<input aria-label="Chat link or number" type="text" maxLength="2048" value=${link} placeholder="/s/123" onInput=${(event) => setLink(event.target.value)} onKeyDown=${(event) => { if (event.key === 'Enter') { event.preventDefault(); paste(); } }} /></label>
      <button class="button primary" disabled=${busy || !link.trim()} onClick=${paste}>Join workspace from link</button>
      ${error ? html`<p role="alert" class="error-box">${error}</p>` : null}
      <div class="office-v2-workspaces">${rooms.length ? rooms.map((room) => html`<article class="office-v2-desk" key=${room.id} aria-label=${`Workspace ${room.id}`}>
        <strong>${room.unavailable ? `Conversation #${room.id} is unavailable` : room.title}</strong>
        <p class="muted small">#${room.id}${room.id === source ? ' · Current office' : ''}${room.id === openChat ? ' · Open chat' : ''}</p>
        ${!room.unavailable ? html`<p class="muted small">${room.model ?? 'No model selected'}</p><button class="button" disabled=${busy || room.id === source} onClick=${() => choose(room.id)}>${room.id === source ? 'Already in this workspace' : 'Join this workspace'}</button>` : null}
      </article>`) : html`<${pocket.Loader} label="Checking your conversations…" />`}</div>
    </section>`;
  };
}
