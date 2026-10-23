import { uuid } from './uuid.js';
import { createBridge, listenToFrame } from './bridge.js';
import { roomViews } from './views.js';
import { rememberWorkspace } from './workspace.js';
import { worldDocument } from './world-document.js';
export const pocketApi = 1;

export default function setup(pocket) {
  const { html, useState, useRef, useEffect, useLayoutEffect } = pocket;
  const listeners = new Set();
  const changed = (event) => { for (const listener of listeners) listener(event); };
  const { Avatar } = roomViews(pocket, changed);
  pocket.style('style.css');

  function Office() {
    const [identity, setIdentity] = useState(null);
    const [floors, setFloors] = useState([]);
    const [source, setSource] = useState(null);
    const [snapshot, setSnapshot] = useState(null);
    const [scene, setScene] = useState(null);
    const [overlay, setOverlay] = useState(null);
    const [error, setError] = useState('');
    const [generation, setGeneration] = useState(0);
    const [fullscreen, setFullscreen] = useState(false);
    const [recovering, setRecovering] = useState(null);
    const [recoveryError, setRecoveryError] = useState('');
    const [smallWindow, setSmallWindow] = useState(false);
    const documentHtml = !smallWindow && scene?.source === source ? scene.html : null;
    const host = useRef(null);
    const frame = useRef(null);
    const clientId = useRef(uuid());
    const liveBridge = useRef(null);
    const currentOverlay = useRef(null);
    currentOverlay.current = overlay;
    const asset = useRef(null);
    const latest = useRef(null);
    latest.current = snapshot;

    useEffect(() => {
      const stop = new AbortController();
      async function bootstrap() {
        if (typeof pocket.Conversation !== 'function') throw new Error('This 3D office requires the Pocket conversation-view SDK update. The installed stock 0.19 SDK cannot embed worker conversations.');
        const [person, rooms, document] = await Promise.all([
          pocket.api('profile', undefined, { signal: stop.signal }),
          pocket.api('floors', undefined, { signal: stop.signal }),
          fetch(new URL('./office-document.json', import.meta.url), { signal: stop.signal }).then(async (res) => {
            if (!res.ok) throw new Error('The packaged Office world is missing. Build the extension first.');
            return res.json();
          }),
        ]);
        if (stop.signal.aborted) return;
        const current = pocket.conversationId();
        let remembered;
        try { remembered = Number(localStorage.getItem(`x.office-v2.${encodeURIComponent(person.person.id)}.workspace`)); } catch { /* Optional preference. */ }
        const selected = rooms.find((room) => room.id === remembered) ?? rooms.find((room) => room.id === current) ?? rooms[0];
        asset.current = document.html;
        setIdentity(person); setFloors(rooms); setSource(selected?.id ?? null);
      }
      bootstrap().catch((failure) => { if (!stop.signal.aborted) setError(failure.message); });
      return () => stop.abort();
    }, []);

    useEffect(() => {
      if (!source || !identity || !asset.current || smallWindow) return;
      const stop = new AbortController();
      setScene(null); setOverlay(null); setError(''); setRecovering(null); setRecoveryError('');
      async function enter() {
        const rooms = await pocket.api('floors', undefined, { signal: stop.signal });
        if (!rooms.some((room) => room.id === source)) throw new Error('This chat floor is archived or unavailable. Return to Pocket and choose an accessible root chat.');
        const self = latest.current?.source === source ? latest.current.peers.find((peer) => peer.id === latest.current.you) : null;
        const presence = { ...identity.profile, lite: false, ...(self ? { x:self.x,y:self.y,z:self.z,rotY:self.rotY,moving:false } : {}) };
        const state = await pocket.api(`state/${source}?${new URLSearchParams({ clientId:clientId.current, presence:JSON.stringify(presence) })}`, undefined, { signal:stop.signal });
        if (stop.signal.aborted) return;
        const channel = uuid();
        const boot = { person:state.person, profile:state.profile, snapshot:state, floors:rooms };
        const document = worldDocument(asset.current, new URL('./world/', import.meta.url).href, channel, boot, new URL('./frame-errors.js', import.meta.url).href);
        setFloors(rooms); setSnapshot(state); setScene({source,channel,html:document});
        rememberWorkspace(identity.person.id, source);
      }
      enter().catch((failure) => { if (!stop.signal.aborted) setError(failure.message); });
      return () => stop.abort();
    }, [source, identity, generation, smallWindow]);

    useEffect(() => {
      const stop = new AbortController();
      const update = async (event) => {
        if (event !== 'profile') return;
        try { const person = await pocket.api('profile', undefined, { signal:stop.signal }); if (!stop.signal.aborted) setIdentity(person); }
        catch (failure) { if (!stop.signal.aborted) setError(failure.message); }
      };
      listeners.add(update);
      return () => { stop.abort(); listeners.delete(update); };
    }, []);

    useLayoutEffect(() => {
      if (!documentHtml || !frame.current || !source || scene.source !== source) return;
      const boundFrame = frame.current;
      const boundChannel = scene.channel;
      const stop = new AbortController();
      const timers = new Set();
      const bridge = createBridge({ pocket, source, clientId:clientId.current, signal:stop.signal,
        customize: () => setOverlay({ kind:'avatar' }),
        workspace: () => setOverlay({ kind:'floors' }),
        inspect: (worker) => { if (!stop.signal.aborted) setOverlay({ kind:'worker', ...worker, key:uuid() }); },
        switchFloor: async (target) => {
          const rooms = await pocket.api('floors', undefined, { signal:stop.signal });
          if (!rooms.some((room) => room.id === target)) throw new Error('That chat floor is not available to your account.');
          await pocket.api(`state/${target}?${new URLSearchParams({ clientId:clientId.current })}`, undefined, { signal:stop.signal });
          if (stop.signal.aborted) throw new Error('The office is closed.');
          // Acknowledge the old scene before replacing it. Never move its workers or other participants.
          const timer = setTimeout(() => {
            timers.delete(timer);
            if (!stop.signal.aborted) { setOverlay(null); setFloors(rooms); setSource(target); if (target === source) setGeneration((g) => g + 1); }
          }, 0);
          timers.add(timer);
        },
        onSnapshot: (state) => {
          if (stop.signal.aborted || state.source !== source) return;
          setSnapshot(state);
          // Also synchronize after connect, when an inspector opened before the world was ready.
          boundFrame.contentWindow?.postMessage({type:'office-v2:overlay',channel:boundChannel,open:!!currentOverlay.current},location.origin);
        },
      });
      liveBridge.current = bridge;
      const unlisten = listenToFrame({ frame:boundFrame, origin:location.origin, channel:boundChannel, handle:bridge,
        onError:(message) => { if (!stop.signal.aborted) setError(message); },
      });
      return () => { stop.abort(); unlisten(); if (liveBridge.current === bridge) liveBridge.current = null; for (const timer of timers) clearTimeout(timer); };
    }, [scene, source, smallWindow]);

    useEffect(() => {
      if (!documentHtml || scene.source !== source) return;
      frame.current?.contentWindow?.postMessage({ type:'office-v2:overlay', channel:scene.channel, open:!!overlay }, location.origin);
      if (!overlay) frame.current?.focus();
    }, [overlay, scene, source]);
    useEffect(() => {
      const key = (event) => { if (event.key === 'Escape' && overlay) { event.stopPropagation(); setOverlay(null); } };
      window.addEventListener('keydown', key);
      return () => window.removeEventListener('keydown', key);
    }, [overlay]);
    useEffect(() => {
      const update = () => setSmallWindow(window.innerWidth < 1024 || window.innerHeight < 600);
      update(); window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }, []);
    useEffect(() => {
      const update = () => setFullscreen(document.fullscreenElement === host.current);
      document.addEventListener('fullscreenchange', update);
      return () => document.removeEventListener('fullscreenchange', update);
    }, []);

    async function toggleFullscreen() {
      try {
        if (document.fullscreenElement === host.current) await document.exitFullscreen();
        else await host.current?.requestFullscreen();
      } catch { setError('Fullscreen is unavailable in this browser. The office still fills its Pocket page.'); }
    }
    async function leave() {
      if (document.fullscreenElement === host.current) await document.exitFullscreen();
      if (source) pocket.openConversation(source);
      pocket.closePage();
    }
    function openMaster() {
      if (!snapshot?.master) return;
      const bridge = liveBridge.current;
      if (!bridge) return;
      bridge('open', { workerId:snapshot.master.workerId }).catch((failure) => { if (liveBridge.current === bridge) setError(failure.message); });
    }

    async function recoverPending(pending, release = false) {
      const bridge = liveBridge.current;
      if (!bridge || recovering) return;
      const view = overlay;
      setRecovering(pending.workerId); setRecoveryError('');
      try {
        if (release) await bridge('dismiss', {workerId:pending.workerId,key:uuid()});
        else await bridge('hire', {deskId:pending.deskId,prompt:pending.prompt,key:pending.requestId});
        if (liveBridge.current === bridge && currentOverlay.current === view) setOverlay(null);
      } catch (failure) { if (liveBridge.current === bridge && currentOverlay.current === view) setRecoveryError(failure.message); }
      finally { if (liveBridge.current === bridge) setRecovering(null); }
    }

    return html`<section class="office-v2-world" ref=${host} aria-label="3D Pocket office">
      <header class="office-v2-worldbar"><strong title=${snapshot?.title}>${snapshot?.title ?? 'Office v2'}</strong>
        <button class="button" disabled=${!snapshot?.master} onClick=${openMaster}>Master chat</button>
        ${snapshot?.pending?.length ? html`<button class="button" onClick=${() => { setRecoveryError(''); setOverlay({kind:'pending'}); }}>Pending hires (${snapshot.pending.length})</button>` : null}
        <button class="button" onClick=${toggleFullscreen}>${fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</button>
        <button class="button" onClick=${leave}>Back to chat</button>
      </header><div class="office-v2-world-stage">
      ${smallWindow ? html`<div class="office-v2-desktop-required" role="alert"><strong>Desktop Office</strong><p>Use a computer window at least 1024 × 600. Office keeps its desktop controls; it does not switch to an iPhone layout.</p><button class="button" onClick=${toggleFullscreen}>Fullscreen</button><button class="button" onClick=${leave}>Back to Pocket</button></div>` : null}
      ${error ? html`<div class="office-v2-world-error" role="alert">${error}<button class="button" onClick=${() => { setError(''); setGeneration((g) => g + 1); }}>Retry floor</button><button class="button" onClick=${leave}>Return to Pocket</button></div>` : null}
      ${documentHtml ? html`<iframe key=${scene.channel} class="office-v2-worldframe" ref=${frame} title="Office v2 multiplayer world" sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms" allow="fullscreen" srcDoc=${documentHtml}></iframe>` : !error ? html`<div class="office-v2-world-loading"><${pocket.Loader} label=${identity && !floors.length ? 'No root chats. Create a chat in Pocket first.' : 'Entering your chat floor…'} /></div>` : null}
      ${overlay ? html`<div class="office-v2-inspector-scrim"><section class="office-v2-inspector" role="dialog" aria-label=${overlay.kind === 'worker' ? overlay.master ? 'Master conversation' : 'Worker conversation' : overlay.kind === 'avatar' ? 'My appearance' : overlay.kind === 'pending' ? 'Pending hires' : 'Chat floors'}>
        <header><strong>${overlay.kind === 'worker' ? `${overlay.master ? 'Master · ' : ''}${overlay.title}` : overlay.kind === 'avatar' ? 'My appearance' : overlay.kind === 'pending' ? 'Pending hires' : 'Chat floors'}</strong><button class="button" aria-label="Close inspector" onClick=${() => setOverlay(null)}>✕</button></header>
        ${overlay.kind === 'worker' ? html`<div class="office-v2-inspector-view"><${pocket.Conversation} key=${overlay.key} conversationId=${overlay.conversationId} draft=${overlay.draft} title=${overlay.title} onClose=${() => setOverlay(null)} /></div>`
          : overlay.kind === 'avatar' ? html`<${Avatar} close=${() => setOverlay(null)} />`
          : overlay.kind === 'pending' ? html`<div class="office-v2-avatar"><p>These original hires may already have started model work. Recover the same receipt; do not submit the task again. Releasing a desk does not stop or undo work.</p>
              ${recoveryError ? html`<p role="alert">${recoveryError}</p>` : null}
              ${(snapshot?.pending ?? []).map((pending) => html`<article key=${pending.workerId}><strong>${pending.deskId}</strong><p>${pending.prompt}</p><button class="button" disabled=${!!recovering || !pending.recoverable} onClick=${() => recoverPending(pending)}>${recovering === pending.workerId ? 'Working…' : 'Recover original hire'}</button> <button class="button" disabled=${!!recovering} onClick=${() => recoverPending(pending,true)}>Release reservation</button></article>`)}
              ${!snapshot?.pending?.length ? html`<p>No pending hires remain.</p>` : null}</div>`
          : html`<p>Use the elevator in the 3D world to choose a chat floor.</p><button class="button" onClick=${() => setOverlay(null)}>Return to the elevator</button>`}
      </section></div>` : null}
    </div></section>`;
  }

  pocket.page({ id:'office-v2-world', title:'Office v2', icon:'grid', component:Office });
  pocket.rail({ id:'office-v2', title:'Office v2', icon:'grid', page:'office-v2-world' });
  pocket.launcher({ id:'office-v2', label:'Open 3D Office', detail:'Chat floors, master desk, and real Pocket workers', icon:'grid', page:'office-v2-world' });
}
