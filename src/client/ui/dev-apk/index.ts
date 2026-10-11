import './ui.css';
import { h, openModal, type Modal } from '../dom';
import { store } from '../../state';
import type { HudAction } from '../menu';
import type { DevApkBuild, DevApkView } from '../../../shared/dev-apk';
const labels: Record<DevApkBuild['status'], string> = { starting: 'Build wird gestartet', waiting: 'Warte auf freien Build-Platz', building: 'Dev-APK wird gebaut', publishing: 'Download wird vorbereitet', ready: 'Build erfolgreich', failed: 'Build fehlgeschlagen', interrupted: 'Build unterbrochen' };
let modal: Modal | undefined;
export const devApkAction: HudAction = { id: 'dev-apk', icon: '📦', label: 'Dev-APK', section: 'Open', run: () => openDevApk() };
export function openDevApk() {
  if (modal) return;
  const floor = store.floor; if (!floor) return;
  const url = '/api/dev-apk?floor=' + encodeURIComponent(floor);
  const status = h('div.dev-apk-status', { role: 'status' }, 'Lade Build-Status…');
  const latest = h('section.dev-apk-card'), current = h('section.dev-apk-card');
  const log = h('pre.dev-apk-log'), error = h('p.dev-apk-error', { role: 'alert' });
  const logDetails = h('details', {}, h('summary', {}, 'Build-Protokoll'), log);
  let stopped = false, pending = false;
  const startButton = h('button.btn.primary', { type: 'button', disabled: true, onclick: async () => {
    pending = true; startButton.disabled = true; error.textContent = '';
    try { const response = await fetch(url, { method: 'POST' }); const result = await response.json(); if (!response.ok) throw Error(result.error); }
    catch (e) { error.textContent = (e as Error).message; }
    finally { pending = false; await refresh(); }
  } }, 'Dev-APK bauen');
  const link = (id?: string) => '/api/dev-apk/download?floor=' + encodeURIComponent(floor) + (id ? '&id=' + encodeURIComponent(id) : '');
  const copyLink = h('button.btn', { type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(new URL(link(), location.href).href); error.textContent = 'Download-Link kopiert. Der Empfänger benötigt seinen Office-Login.'; }
    catch { error.textContent = new URL(link(), location.href).href; }
  } }, 'Download-Link kopieren');
  async function refresh() {
    if (stopped) return;
    try {
      const response = await fetch(url); const data: DevApkView & { error?: string } = await response.json(); if (!response.ok) throw Error(data.error);
      if (stopped) return;
      startButton.disabled = pending || !data.canBuild || !!data.busy;
      status.textContent = !data.configured ? 'Für dieses Projekt ist noch kein Build-Rechner eingerichtet.' : data.busy ? (data.current && !['ready', 'failed', 'interrupted'].includes(data.current.status) ? labels[data.current.status] : 'Ein anderes Projekt wird gerade gebaut.') : 'Bereit';
      current.replaceChildren(h('div', {}, h('h3', {}, 'Neuen Dev-Build erstellen'), h('p', {}, data.configured ? `Quelle: ${data.ref}. Der Server baut den neuesten Stand dieses Branches.` : 'Der Office-Administrator richtet den Build-Ablauf einmal auf dem Server ein.'), startButton,
        data.configured && !data.canBuild ? h('p', {}, 'Du kannst APKs herunterladen. Für Build-Starts muss dich ein Administrator freischalten.') : null,
        data.current ? h('p', {}, `${labels[data.current.status]} · ${new Date(data.current.startedAt).toLocaleString()} · ${data.current.requestedBy}`, data.current.error ? h('span', {}, ' — ' + data.current.error) : null) : null));
      latest.replaceChildren(h('h3', {}, 'Neueste erfolgreiche Dev-APK'));
      if (data.latest) {
        const apk = data.latest;
        latest.append(h('p', {}, `${new Date(apk.finishedAt!).toLocaleString()} · ${Math.round(apk.bytes! / 1048576)} MB · Commit ${apk.revision?.slice(0, 12)}`),
          h('div.dev-apk-actions', {}, h('a.btn.primary', { href: link(apk.id) }, 'APK herunterladen'), copyLink),
          h('details', {}, h('summary', {}, 'SHA-256 prüfen'), h('code', {}, apk.sha256 ?? '')));
      } else latest.append(h('p', {}, 'Noch keine APK vorhanden. Nach dem ersten erfolgreichen Build erscheint hier der Download.'));
      log.textContent = data.log || 'Noch kein Build-Protokoll.';
    } catch (e) { if (!stopped) { error.textContent = (e as Error).message; startButton.disabled = true; } }
  }
  modal = openModal(h('section.dev-apk-dialog', { role: 'dialog', 'aria-label': 'Dev-APK', 'aria-modal': 'true' },
    h('header', {}, h('h2', {}, '📦 Dev-APK')), h('div.dev-apk-body', {},
      h('p', {}, 'Dev-Versionen bauen und mit deinem Testteam teilen. Unity wird nur auf dem Build-Rechner benötigt.'), status, latest, current, error, logDetails,
      h('details', {}, h('summary', {}, 'Auf der Quest installieren'), h('p', {}, 'APK auf dem eigenen PC herunterladen. Quest im Entwicklermodus per USB verbinden und die Datei mit Meta Quest Developer Hub oder ADB installieren. Unity ist dafür nicht nötig.'),
        h('p', {}, 'Bei unterschiedlicher Signatur zur Store-Version ist kein direktes Update möglich. Eine vorhandene App nicht ohne Sicherung ihrer Daten deinstallieren.')))), { onClose: () => { stopped = true; clearInterval(timer); off(); modal = undefined; } });
  const timer = setInterval(() => { void refresh(); }, 2500);
  const off = store.on('floor', () => { if (store.floor !== floor) modal?.close(); });
  void refresh();
}
