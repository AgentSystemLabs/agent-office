import { createBridge, listenToFrame } from './bridge.js';
import { roomViews, roomPeople, workerStatus } from './views.js';
export const pocketApi = 1;

export default function setup(pocket) {
  if (typeof pocket.panel !== 'function' || typeof pocket.insertText !== 'function') throw new Error('Office v2 requires Pi Pocket 0.19.0 or later.');
  const { html, useState, useRef, useEffect, useLayoutEffect } = pocket;
  const listeners = new Set();
  const changed = (event, snapshot) => { for (const listener of listeners) listener(event, snapshot); };
  const { Avatar, Hire } = roomViews(pocket, changed);
  let workspace = null;
  let initializedFor = null;
  pocket.style('style.css');

  function Office() {
    const [source, setSource] = useState(() => workspace ?? pocket.conversationId());
    const [identity, setIdentity] = useState(null);
    const [snapshot, setSnapshot] = useState(null);
    const [view, setView] = useState('room');
    const [documentHtml, setDocumentHtml] = useState(null);
    const [error, setError] = useState('');
    const [generation, setGeneration] = useState(0);
    const [working, setWorking] = useState(false);
    const frame = useRef(null);
    const channel = useRef(null);
    const clientId = useRef(crypto.randomUUID());
    const latest = useRef(null);
    latest.current = snapshot;
    const actionScope = useRef(null);
    useLayoutEffect(() => {
      const scope = { source, stop: new AbortController() };
      actionScope.current = scope; setWorking(false);
      return () => scope.stop.abort();
    }, [source]);
    function acceptSnapshot(state) {
      if (state.source !== source) return;
      setSnapshot(state);
      setIdentity((before) => {
        const next = { person: state.person, profile: state.profile };
        return JSON.stringify(before) === JSON.stringify(next) ? before : next;
      });
    }

    useEffect(() => {
      const update = (event, state) => {
        if (event === 'profile') setGeneration((g) => g + 1);
        else if (state?.source === source) acceptSnapshot(state);
      };
      listeners.add(update);
      return () => listeners.delete(update);
    }, [source]);

    useEffect(() => {
      const stop = new AbortController();
      setError(''); setIdentity(null); setSnapshot(null); setDocumentHtml(null);
      async function bootstrap() {
        // Native Pocket identity and data are prerequisites. The Office renderer is not.
        const person = await pocket.api('profile', undefined, { signal: stop.signal });
        if (stop.signal.aborted) return;
        const key = `x.office-v2.${person.person.id}.workspace`;
        if (initializedFor !== person.person.id) {
          initializedFor = person.person.id;
          try {
            const saved = Number(localStorage.getItem(key));
            if (Number.isSafeInteger(saved) && saved > 0 && saved !== source) {
              workspace = saved; setSource(saved); return;
            }
          } catch { /* Browser storage is optional; it never grants workspace access. */ }
        }
        if (!source) { setIdentity(person); return; }
        workspace = source;
        const query = new URLSearchParams({ clientId: clientId.current, presence: JSON.stringify({ ...person.profile, lite: true }) });
        const state = await pocket.api(`state/${source}?${query}`, undefined, { signal: stop.signal });
        if (!stop.signal.aborted) {
          acceptSnapshot(state);
          try { localStorage.setItem(key, String(source)); } catch { /* Storage can be unavailable. */ }
        }
      }
      bootstrap().catch((failure) => { if (!stop.signal.aborted) setError(failure.message); });
      return () => stop.abort();
    }, [source, generation]);

    useEffect(() => {
      if (!identity || !source) return;
      const stop = new AbortController();
      let inFlight = false;
      const timer = setInterval(async () => {
        if (inFlight || stop.signal.aborted) return;
        inFlight = true;
        try {
          const query = new URLSearchParams({ clientId: clientId.current });
          if (view === 'room') query.set('presence', JSON.stringify({ ...identity.profile, lite: true }));
          const state = await pocket.api(`state/${source}?${query}`, undefined, { signal: stop.signal });
          if (!stop.signal.aborted) acceptSnapshot(state);
        } catch (failure) { if (!stop.signal.aborted) setError(failure.message); }
        finally { inFlight = false; }
      }, 2000);
      return () => { clearInterval(timer); stop.abort(); };
    }, [identity, source, view]);

    useEffect(() => {
      if (view !== '3d' || !identity || !latest.current) { setDocumentHtml(null); return; }
      const stop = new AbortController();
      channel.current = crypto.randomUUID();
      setDocumentHtml(null);
      async function loadWorld() {
        const res = await fetch(new URL('./office-document.json', import.meta.url), { signal: stop.signal });
        if (!res.ok) throw new Error('The optional 3D bundle is missing. The native room remains available.');
        const asset = await res.json();
        const boot = { person: identity.person, profile: identity.profile, snapshot: latest.current };
        const root = new URL('./world/', import.meta.url).href;
        const meta = `<meta name="pocket-runtime" content="1"><meta name="pocket-channel" content="${channel.current}"><meta name="pocket-bootstrap" content="${encodeURIComponent(JSON.stringify(boot))}"><script src="${new URL('./frame-errors.js', import.meta.url).href}"></script>`;
        const resolved = asset.html.replace(/\b(src|href)="(\.\/[^\"]+)"/g, (_all, attribute, path) => `${attribute}="${new URL(path, root).href}"`);
        if (!stop.signal.aborted) setDocumentHtml(resolved.replace('<head>', `<head>${meta}`));
      }
      loadWorld().catch((failure) => { if (!stop.signal.aborted) setError(failure.message); });
      return () => stop.abort();
    }, [view, identity, source]);

    useLayoutEffect(() => {
      if (!documentHtml || !frame.current || !source) return;
      const stop = new AbortController();
      const unlisten = listenToFrame({ frame: frame.current, origin: location.origin, channel: channel.current,
        handle: createBridge({ pocket, source, clientId: clientId.current, signal: stop.signal,
          customize: () => pocket.openSheet('office-v2-avatar'),
          onSnapshot: (state) => { if (!stop.signal.aborted) acceptSnapshot(state); },
        }),
        onError: (message) => { if (!stop.signal.aborted) setError(message); },
      });
      return () => { stop.abort(); unlisten(); };
    }, [documentHtml, source]);

    async function action(run) {
      const scope = actionScope.current;
      if (!scope || scope.source !== source || scope.stop.signal.aborted) return;
      const active = () => actionScope.current === scope && !scope.stop.signal.aborted;
      const apply = (state) => { if (active()) acceptSnapshot(state); };
      setWorking(true); setError('');
      try { await run(scope.stop.signal, apply); }
      catch (failure) { if (active()) setError(failure.message); }
      finally { if (active()) setWorking(false); }
    }
    const openWorker = (workerId) => action((signal) => createBridge({ pocket, source, clientId: clientId.current, signal })('open', { workerId }));
    const releaseWorker = (workerId) => {
      if (!confirm('Release this desk? The Pocket session will keep running and remain in your session list.')) return;
      return action(async (signal, apply) => apply(await pocket.api(`dismiss/${source}`, { clientId: clientId.current, workerId }, { signal })));
    };
    const recover = (reservation) => action(async (signal, apply) => apply(await pocket.api(`hire/${source}`, { clientId: clientId.current, deskId: reservation.deskId, prompt: reservation.prompt, requestId: reservation.requestId }, { signal })));
    function changeWorkspace() {
      const current = pocket.conversationId();
      if (!current || current === source) return;
      if (!confirm('Use this conversation as the office workspace? Existing desks stay with their previous workspace.')) return;
      workspace = current; setSource(current); setView('room');
    }

    return html`<section class="office-v2-shell">
      <div class="office-v2-toolbar">
        <span><strong>Office v2</strong>${identity ? ` · ${identity.person.name}` : ''}</span>
        <button class="button" onClick=${() => pocket.openSheet('office-v2-avatar')}>My appearance</button>
        <button class="button" onClick=${() => setGeneration((g) => g + 1)}>Refresh</button>
        <button class="button" onClick=${changeWorkspace}>Use this conversation</button>
      </div>
      ${error ? html`<div role="alert" class="error-box">${error}<button class="button" onClick=${() => setError('')}>Dismiss notice</button></div>` : null}
      ${!source ? html`<p class="office-v2-note">Open a root conversation to choose the workspace. Your identity and appearance are already linked to your Pocket account.</p>` : !snapshot ? !error ? html`<${pocket.Loader} label="Loading your Pocket workspace…" />` : null : html`
        <div class="office-v2-room-head"><h2>${snapshot.title}</h2><p class="muted small">${snapshot.cwd}</p><p class="muted small">${snapshot.model ? `New agents inherit ${snapshot.model}, thinking, tools, and the team budget.` : 'No workspace model selected. Choose a model in Pocket before hiring.'}</p>
          <div class="office-v2-people" aria-label="People in the office">${roomPeople(snapshot.peers).map((peer) => html`<span class="office-v2-person" key=${peer.id}><span style=${`color:${peer.color}`}>●</span> ${peer.name}</span>`)}</div>
          <div class="office-v2-tabs"><button class="button" aria-pressed=${view === 'room'} onClick=${() => setView('room')}>Room & desks</button><button class="button" aria-pressed=${view === '3d'} onClick=${() => setView('3d')}>3D office (optional)</button></div>
        </div>
        ${(snapshot.pending ?? []).map((reservation) => html`<div class="office-v2-note" key=${reservation.workerId}>Pending hire at ${reservation.deskId}. A session may already be running.
          <button class="button" disabled=${working || !reservation.recoverable} onClick=${() => recover(reservation)}>Recover original hire</button>
        </div>`)}
        ${view === '3d' ? html`<p class="office-v2-note">The same people and agents, shown in 3D. Return to Room & desks at any time.</p>${documentHtml ? html`<iframe ref=${frame} class="office-v2-frame" title="Office v2 multiplayer workspace" sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms" allow="fullscreen" srcDoc=${documentHtml}></iframe>` : html`<${pocket.Loader} label="Loading optional 3D view…" />`}` : html`
          <div class="office-v2-desks" aria-label="Agent desks">${Array.from({ length: 16 }, (_, n) => {
            const deskId = `desk-${n + 1}`;
            const worker = snapshot.workers.find((item) => item.deskId === deskId);
            return html`<article class="office-v2-desk" key=${deskId} aria-label=${`Desk ${n + 1}`}><h3>Desk ${n + 1}</h3>
              ${worker ? html`<p><strong>${worker.name}</strong></p><p class="muted small">${workerStatus(worker.status)} · Pocket session</p><button class="button primary" disabled=${working} onClick=${() => openWorker(worker.id)}>Open conversation</button><button class="button" disabled=${working} onClick=${() => releaseWorker(worker.id)}>Release desk</button>` : html`<p class="muted">No visible worker</p><button class="button" onClick=${() => pocket.openSheet('office-v2-hire', { source, deskId, clientId: clientId.current })}>Hire agent</button>`}
            </article>`;
          })}</div>`}
        <p class="office-v2-note">Messages, tools, and approvals stay in native Pocket conversations. Idle is not task success. Releasing a desk does not stop or delete its session. Hidden or reserved desks can refuse a hire.</p>
      `}
    </section>`;
  }
  pocket.sheet({ id: 'office-v2-avatar', title: 'My office appearance', component: Avatar });
  pocket.sheet({ id: 'office-v2-hire', title: 'Hire a Pocket agent', component: Hire });
  pocket.panel({ id: 'office-v2', title: 'Office v2', icon: 'grid', component: Office, wide: true });
  pocket.rail({ id: 'office-v2', title: 'Office v2', icon: 'grid', panel: 'office-v2' });
  pocket.launcher({ id: 'office-v2', label: 'Open Office v2', detail: 'Shared desks backed by real Pocket sessions', icon: 'grid', panel: 'office-v2' });
}
