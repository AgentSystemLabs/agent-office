const COLORS = ['#ff8a5b', '#4f86f7', '#06d6a0', '#ef476f', '#ffd166', '#9d4edd', '#00b4d8', '#f77f00'];
const HAIR = ['Short', 'Long', 'Bun', 'Spiky', 'Curly', 'Ponytail', 'Bald'];

// Presence is per browser instance. The native room lists accounts, not duplicate tabs.
export function roomPeople(peers) {
  const people = new Map();
  for (const peer of peers) {
    const boundary = peer.id.lastIndexOf(':');
    people.set(boundary < 0 ? peer.id : peer.id.slice(0, boundary), peer);
  }
  return [...people.values()];
}
export function workerStatus(status) {
  return status === 'working' ? 'Working' : status === 'idle' ? 'Idle' : 'Status unavailable';
}

export function roomViews(pocket, changed) {
  const { html, useState, useRef, useEffect } = pocket;
  function Avatar({ close }) {
    const [profile, setProfile] = useState(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    useEffect(() => {
      const stop = new AbortController();
      pocket.api('profile', undefined, { signal: stop.signal }).then((data) => setProfile(data.profile), (failure) => { if (!stop.signal.aborted) setError(failure.message); });
      return () => stop.abort();
    }, []);
    const look = (field, value) => setProfile((p) => ({ ...p, look: { ...p.look, [field]: Number(value) } }));
    async function save() {
      setSaving(true); setError('');
      try {
        await pocket.api('profile', { color: profile.color, look: profile.look });
        changed('profile'); close();
      } catch (failure) { setError(failure.message); }
      finally { setSaving(false); }
    }
    return html`<section class="office-v2-avatar">
      <p>Your identity comes from Pocket. Your appearance belongs to your account, across browsers and conversations.</p>
      ${error ? html`<p role="alert" class="error-box">${error}</p>` : null}
      ${profile ? html`<p><strong>${profile.name}</strong></p>
        <label>Shirt color<select aria-label="Shirt color" value=${profile.color} onChange=${(event) => setProfile((p) => ({ ...p, color: event.target.value }))}>${[...new Set([profile.color, ...COLORS])].map((color) => html`<option value=${color}>${color}</option>`)}</select></label>
        <label>Skin tone<select aria-label="Skin tone" value=${profile.look.skin} onChange=${(event) => look('skin', event.target.value)}>${Array.from({ length: 8 }, (_, i) => html`<option value=${i}>Tone ${i + 1}</option>`)}</select></label>
        <label>Hair style<select aria-label="Hair style" value=${profile.look.style} onChange=${(event) => look('style', event.target.value)}>${HAIR.map((name, i) => html`<option value=${i}>${name}</option>`)}</select></label>
        <label>Hair color<select aria-label="Hair color" value=${profile.look.hair} onChange=${(event) => look('hair', event.target.value)}>${Array.from({ length: 10 }, (_, i) => html`<option value=${i}>Color ${i + 1}</option>`)}</select></label>
        <button class="button primary" disabled=${saving} onClick=${save}>${saving ? 'Saving…' : 'Save my appearance'}</button>` : html`<${pocket.Loader} label="Loading your appearance…" />`}
    </section>`;
  }
  function Hire({ close, source, deskId, clientId }) {
    const [prompt, setPrompt] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const key = useRef(crypto.randomUUID());
    const submitted = useRef(null);
    async function hire() {
      setSaving(true); setError('');
      // Once attempted, retain the original task and key. An uncertain admission must not become a new hire.
      submitted.current ??= prompt.trim();
      try {
        const snapshot = await pocket.api(`hire/${source}`, { clientId, deskId, prompt: submitted.current, requestId: key.current });
        changed('state', snapshot); close();
      } catch (failure) { setError(`${failure.message} Retry uses this same task and hire key. A pending hire can also be recovered from the room.`); }
      finally { setSaving(false); }
    }
    return html`<section class="office-v2-avatar">
      <p>Hire a real Pocket agent at <strong>${deskId}</strong>. It inherits workspace #${source}’s model, thinking, folder, tools, and team budget.</p>
      <label>Initial task<textarea aria-label="Initial task" rows="6" maxLength="8000" value=${prompt} disabled=${saving || submitted.current !== null} onInput=${(event) => setPrompt(event.target.value)} placeholder="What should this agent work on?"></textarea></label>
      ${error ? html`<p role="alert" class="error-box">${error}</p>` : null}
      <button class="button primary" disabled=${saving || !prompt.trim()} onClick=${hire}>${saving ? 'Hiring…' : submitted.current !== null ? 'Recover this hire' : 'Hire agent'}</button>
      <p class="muted small">This starts model work. Follow-ups and approvals happen in the agent’s native Pocket conversation.</p>
    </section>`;
  }
  return { Avatar, Hire };
}
