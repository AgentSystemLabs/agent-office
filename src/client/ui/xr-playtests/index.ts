import './ui.css';
import { h, openModal, closeAllModals } from '../dom';
import { store } from '../../state';
import { playtestBugButton } from '../playtests/bug';
import { ruleEditor } from './rules';
import type { XrView } from '../../../shared/xr-session';
export function xrSessionButton() {
  return h('button.btn.primary', { type: 'button', onclick: () => { closeAllModals(); openXrSession(); } }, '🥽 Headset-Testbegleitung');
}
export function openXrSession() {
  const floor = store.floor, url = `/api/playtests/xr-session?floor=${encodeURIComponent(floor ?? '')}`;
  let alive = true, busy = false, view: XrView | undefined, runId: string | undefined, timer: ReturnType<typeof setTimeout>;
  let chosen = new Set<string>(), deviceKey = '', cardsKey = '', actionKey = '', displayedRun = '';
  const evidenceNodes = new Map<string, { text: HTMLElement; values: HTMLElement }>();
  const cardCache = new Map<string, { key: string; details: HTMLDetailsElement }>();
  const status = h('p.xr-status', { role: 'status', 'aria-live': 'polite' }, 'Lade Testbegleitung…');
  const error = h('p.xr-error', { role: 'alert' });
  const controls = h('div.xr-controls'), pairing = h('div.xr-pairing'), devices = h('div.xr-devices'), cards = h('div.xr-cards'), actions = h('div.xr-actions');
  const history = h('select', { 'aria-label': 'Gespeicherte Testläufe', onchange: () => { runId = history.value; deviceKey = cardsKey = ''; void refresh(); } });
  const root = h('div.modal.xr-modal', { role: 'dialog', 'aria-label': 'Headset-Testbegleitung' },
    h('header', {}, h('h2', {}, '🥽 Headset-Testbegleitung')),
    h('div.xr-body', {}, h('p', {}, 'Eine Begleitung für deine ganze Spielsession. Passende Tests wechseln automatisch mit Modus, Solo/Koop und Spielphase.'),
      status, controls, error, pairing, devices, actions, h('label', {}, 'Gespeicherte Testläufe ', history), cards));
  const modal = openModal(root, { doing: 'accompanying headset playtests', onClose: () => { alive = false; clearTimeout(timer); off(); } });
  const off = store.on('floor', () => { if (store.floor !== floor) modal.close(); });
  function button(label: string, action: string, value?: unknown) {
    return h('button.btn', { type: 'button', disabled: busy, onclick: () => void mutate({ action, id: view?.run?.id, value }) }, label);
  }
  async function mutate(body: unknown) {
    if (busy) return; busy = true; error.textContent = ''; render();
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json(); if (!response.ok) throw Error(data.error);
      if (!alive) return;
      if (data.id) runId = data.id;
      if (data.token) {
        const command = `office-xr ${JSON.stringify(location.origin)} ${JSON.stringify(floor)} ${JSON.stringify(data.id)}`;
        pairing.replaceChildren(h('h3', {}, 'PC und Headset verbinden'), h('p', {}, 'Auf dem PC mit ADB und installiertem Office-Helfer ausführen. Anschließend den Kopplungscode eingeben. Der Code gilt nur für diesen Testlauf.'),
          h('pre', {}, command), h('button.btn', { type: 'button', onclick: () => void navigator.clipboard.writeText(command).catch(() => { error.textContent = 'Befehl bitte aus dem Textfeld kopieren.'; }) }, 'Befehl kopieren'),
          h('input', { readonly: true, value: data.token, 'aria-label': 'Kopplungscode' }),
          h('button.btn', { type: 'button', onclick: () => void navigator.clipboard.writeText(data.token).catch(() => { error.textContent = 'Code bitte aus dem Textfeld kopieren.'; }) }, 'Code kopieren'));
      }
      cardsKey = deviceKey = ''; await refresh();
    } catch (e) { if (alive) error.textContent = (e as Error).message; }
    finally { busy = false; if (alive) render(); }
  }
  async function refresh() {
    try {
      const response = await fetch(url + (runId ? `&run=${encodeURIComponent(runId)}` : ''), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const data = await response.json(); if (!response.ok) throw Error(data.error);
      if (!alive) return; view = data; render();
    } catch (e) { if (alive) error.textContent = (e as Error).message; }
  }
  function render() {
    if (!view) return;
    const run = view.run, current = run && run.status !== 'stopped';
    if (run && displayedRun !== run.id) { displayedRun = run.id; chosen = new Set(run.selected); deviceKey = ''; }
    const fresh = !!run?.heartbeat && Date.now() - run.heartbeat < 5000;
    status.textContent = !run ? 'Bereit für deinen nächsten Testlauf' : run.status === 'stopped' ? 'Testlauf beendet – Beobachtungen gespeichert' : run.status === 'paused' ? 'Begleitung pausiert' : !fresh ? 'Warte auf PC-Helfer und Headset-Verbindung' : run.status === 'pairing' ? 'Headsets auswählen und Begleitung starten' : `Begleitung aktiv · ${new Set(view.devices.flatMap(d => d.active)).size} passende Tests`;
    controls.replaceChildren(...(!current ? [button('Headset-Testbegleitung starten', 'start')] : [
      button(run.status === 'paused' ? 'Fortsetzen' : 'Pause', run.status === 'paused' ? 'resume' : 'pause'), button('Beenden', 'stop'), button('PC neu koppeln', 'pair')]),
      h('button.btn', { type: 'button', onclick: () => {
        h('a', { href: `${url}&run=${run?.id ?? ''}&download=1`, download: `playtest-${run?.id ?? 'session'}.json` }).click();
      } }, 'Belege exportieren'));
    if (fresh || !current) pairing.replaceChildren();
    const hk = view.history.map(r => r.id).join();
    if (history.dataset.key !== hk) { history.dataset.key = hk; history.replaceChildren(...view.history.map(r => h('option', { value: r.id }, new Date(r.createdAt).toLocaleString()))); }
    if (run) history.value = run.id;
    const ak = JSON.stringify([run?.id, run?.status, run?.selected, run?.commands, run?.markers?.length, busy]);
    if (ak !== actionKey) { actionKey = ak; actions.replaceChildren(...(run?.status === 'running' ? run.selected.map(device => h('div', {},
      button(`Screenshot · ${device}`, 'command', { device, kind: 'screenshot' }),
      h('details', {}, h('summary', {}, `Testvorbereitung · ${device}`), h('p', {}, 'Diese Aktion verändert ausdrücklich die Testbedingungen: bis zu 120 Reserve-Patronen für die gehaltene Pistole. Nur Solo, keine Spielstände oder Geldwerte. Begleitung allein führt diese Aktion niemals aus.'),
        button('Jetzt Reserve-Munition hinzufügen', 'command', { device, kind: 'reserve-ammo', confirmed: true })))) : []),
      ...(run?.commands ?? []).map(c => h('p', {}, `${c.device} · ${c.kind} · ${c.status === 'pending' ? 'Warte auf Gerät' : c.result}`, c.artifact ? h('a', { href: `${url}&run=${run!.id}&artifact=${c.id}`, target: '_blank', rel: 'noopener noreferrer' }, ' Screenshot öffnen') : null)),
      ...(run?.markers ?? []).slice(-3).map(m => h('p', {}, `Fehler im Headset markiert · ${new Date(m.at).toLocaleTimeString()} · ${m.device} · ${m.context.mode}. Beim passenden Test unten die Beschreibung ergänzen.`)) ); }
    const dk = JSON.stringify([run?.devices, run?.selected, current]);
    if (dk !== deviceKey) {
      deviceKey = dk;
      if (!chosen.size) chosen = new Set(run?.selected ?? []);
      devices.replaceChildren(...(run?.devices ?? []).map(d => {
        const box = h('input', { type: 'checkbox', disabled: !current, 'aria-label': d.name }); box.checked = chosen.has(d.serial);
        box.onchange = () => { if (box.checked) chosen.add(d.serial); else chosen.delete(d.serial); };
        const sample = run?.snapshots[d.serial];
        return h('label', {}, box, `${d.name} · ${d.serial} · ${d.status}${sample ? ` · ${sample.role} · ${sample.context.build}` : ''}`);
      }), ...(current && run.devices.length ? [h('button.btn', { type: 'button', onclick: () => void mutate({ action: 'select', id: run.id, value: [...chosen] }) }, 'Mit ausgewählten Headsets begleiten')] : []));
    }
    const active = new Set(view.devices.flatMap(d => d.active));
    function updateEvidence() {
      for (const [id, nodes] of evidenceNodes) {
        const last = view?.run?.observations.filter(o => o.testId === id).at(-1);
        nodes.text.textContent = last ? `${new Date(last.at).toLocaleString()} · ${last.build} · ${last.device} · ${last.outcome === 'matched' ? 'Technisches Kriterium erfüllt' : last.outcome === 'mismatch' ? 'Abweichung vom technischen Kriterium' : 'Manuelle Bestätigung ausstehend'} ${last.note}` : 'Noch keine Beobachtung';
        nodes.values.textContent = last ? JSON.stringify(last.signals, null, 2) : '';
      }
    }
    updateEvidence();
    const signalNames = Object.keys(run?.snapshots[run.selected[0]]?.signals ?? {});
    const key = JSON.stringify([run?.id, view.devices, view.rules, signalNames, view.tests.map(t => [t.id, t.revision])]);
    if (key === cardsKey || cards.contains(document.activeElement)) return;
    cardsKey = key;
    const expanded = new Set([...cards.querySelectorAll<HTMLDetailsElement>('details[open]')].map(d => d.dataset.id));
    cards.replaceChildren(h('h3', {}, 'Tests und Beobachtungen'), h('p', {}, 'Technische Kriterien sind Belege, keine automatische Bestätigung manueller Tests. Ohne Kriterium werden Kontext und Diagnosewerte gesammelt.'),
      ...view.devices.filter(d => d.reason).map(d => h('p', {}, `${d.serial}: ${d.reason}`)));
    for (const test of [...view.tests].sort((a, b) => Number(active.has(b.id)) - Number(active.has(a.id)))) {
      const observations = run?.observations.filter(o => o.testId === test.id) ?? [];
      const label = active.has(test.id) ? 'Aktiv' : observations.length ? 'Beobachtet' : 'Wartet auf passenden Kontext';
      const cached = cardCache.get(test.id), ck = JSON.stringify([run?.id, test.revision, view.rules[test.id], signalNames]);
      if (cached?.key === ck) { cached.details.querySelector('summary')!.textContent = `${label} · ${test.title}`; cards.append(cached.details); continue; }
      const evidence = () => JSON.stringify({ run: view?.run?.id,
        screenshots: view?.run?.commands?.filter(c => c.artifact).slice(-3).map(c => `.agent-office/xr-evidence/${view!.run!.id}/${c.id}.png`),
        headsetMarker: view?.run?.markers?.at(-1),
        observations: view?.run?.observations.filter(o => o.testId === test.id).slice(-2) }).slice(0, 5900);
      const evidenceText = h('p'), values = h('pre'); evidenceNodes.set(test.id, { text: evidenceText, values });
      const details = h('details.xr-test', {}, h('summary', {}, `${label} · ${test.title}`), h('p.xr-text', {}, test.steps), h('p.xr-text', {}, `Erwartet: ${test.expected}`),
        evidenceText, values,
        ruleEditor(test, view.rules[test.id], signalNames, body => mutate(body)),
        playtestBugButton(test, floor, evidence));
      cardCache.set(test.id, { key: ck, details });
      details.dataset.id = test.id; details.open = expanded.has(test.id); cards.append(details);
    }
    updateEvidence();
  }
  async function tick() { await refresh(); if (alive) timer = setTimeout(tick, 2000); }
  void tick();
}
