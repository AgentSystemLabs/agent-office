import './ui.css';
import { h, openModal, type Modal } from '../dom';
import { store } from '../../state';
import type { HudAction } from '../menu';
import type { ApkKind, DevApkBuild, DevApkView } from '../../../shared/dev-apk';
import { APK_EXTENSIONS } from './extensions';
const labels: Record<DevApkBuild['status'], string> = { starting: 'Build wird gestartet', waiting: 'Warte auf freien Build-Platz', building: 'APK wird gebaut', publishing: 'Download wird vorbereitet', ready: 'Build erfolgreich', failed: 'Build fehlgeschlagen', interrupted: 'Build unterbrochen' };
let modal: Modal | undefined;
export const devApkAction: HudAction = { id: 'dev-apk', icon: '📦', label: 'APK', section: 'Open', run: () => openDevApk() };
export function openDevApk() {
  if (modal) return;
  const floor = store.floor; if (!floor) return;
  let kind: ApkKind = 'development', request = 0;
  const extensions = APK_EXTENSIONS.map(mount => mount());
  const name = () => kind === 'store' ? 'Store-APK' : 'Dev-APK';
  const url = () => '/api/dev-apk?floor=' + encodeURIComponent(floor) + '&kind=' + kind;
  const status = h('div.dev-apk-status', { role: 'status' }, 'Lade Build-Status…');
  const latest = h('section.dev-apk-card'), current = h('section.dev-apk-card');
  const log = h('pre.dev-apk-log'), error = h('p.dev-apk-error', { role: 'alert' });
  const logDetails = h('details', {}, h('summary', {}, 'Build-Protokoll'), log);
  let stopped = false, pending = false;
  const choices = (['development', 'store'] as const).map(value => h('button.btn', { type: 'button', 'aria-pressed': String(kind === value), onclick: () => {
    if (pending || kind === value) return;
    kind = value; choices.forEach((button, i) => button.setAttribute('aria-pressed', String(i === (kind === 'store' ? 1 : 0))));
    latest.replaceChildren(); current.replaceChildren(); log.textContent = ''; error.textContent = ''; status.textContent = 'Lade Build-Status…'; startButton.disabled = true; void refresh();
    extensions.forEach(extension => extension.update());
  } }, value === 'store' ? 'Store-APK' : 'Dev-APK'));
  const startButton = h('button.btn.primary', { type: 'button', disabled: true, onclick: async () => {
    pending = true; startButton.disabled = true; choices.forEach(b => { b.disabled = true; }); error.textContent = '';
    try { const response = await fetch(url(), { method: 'POST' }); const result = await response.json(); if (!response.ok) throw Error(result.error); }
    catch (e) { error.textContent = (e as Error).message; }
    finally { pending = false; choices.forEach(b => { b.disabled = false; }); await refresh(); }
  } }, 'Dev-APK bauen');
  const link = (id?: string) => '/api/dev-apk/download?floor=' + encodeURIComponent(floor) + '&kind=' + kind + (id ? '&id=' + encodeURIComponent(id) : '');
  const copyLink = h('button.btn', { type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(new URL(link(), location.href).href); error.textContent = 'Download-Link kopiert. Der Empfänger benötigt seinen Office-Login.'; }
    catch { error.textContent = new URL(link(), location.href).href; }
  } }, 'Download-Link kopieren');
  async function refresh() {
    if (stopped) return;
    const selected = kind, sequence = ++request;
    try {
      const response = await fetch(url()); const data: DevApkView & { error?: string } = await response.json(); if (!response.ok) throw Error(data.error);
      if (stopped || selected !== kind || sequence !== request) return;
      startButton.textContent = name() + ' bauen';
      startButton.disabled = pending || !data.canBuild || !!data.busy;
      status.textContent = !data.configured ? `Für ${name()} ist noch kein Build-Ablauf eingerichtet.` : data.busy ? (data.current && !['ready', 'failed', 'interrupted'].includes(data.current.status) ? labels[data.current.status] : 'Eine andere APK wird gerade gebaut.') : 'Bereit';
      current.replaceChildren(h('div', {}, h('h3', {}, name() + ' erstellen'), h('p', {}, data.configured ? `Quelle: ${data.ref}. Der Server baut den neuesten Stand dieses Branches.` : 'Der Office-Administrator richtet den Build-Ablauf einmal auf dem Server ein.'),
        h('p', {}, kind === 'store' ? 'Signierter Release-Build mit der Versionsnummer des Store-Build-Ablaufs. Ein Upload zu Meta erfolgt separat.' : 'Development-Build für Debugging und Playtests.'), startButton,
        data.configured && !data.canBuild ? h('p', {}, 'Du kannst APKs herunterladen. Für Build-Starts muss dich ein Administrator freischalten.') : null,
        data.current ? h('p', {}, `${labels[data.current.status]} · ${new Date(data.current.startedAt).toLocaleString()} · ${data.current.requestedBy}`, data.current.error ? h('span', {}, ' — ' + data.current.error) : null) : null));
      latest.replaceChildren(h('h3', {}, 'Neueste erfolgreiche ' + name()));
      if (data.latest) {
        const apk = data.latest;
        latest.append(h('p', {}, `${new Date(apk.finishedAt!).toLocaleString()} · ${Math.round(apk.bytes! / 1048576)} MB · Commit ${apk.revision?.slice(0, 12)}`),
          h('div.dev-apk-actions', {}, h('a.btn.primary', { href: link(apk.id) }, 'APK herunterladen'), copyLink),
          h('details', {}, h('summary', {}, 'SHA-256 prüfen'), h('code', {}, apk.sha256 ?? '')));
      } else latest.append(h('p', {}, 'Noch keine APK vorhanden. Nach dem ersten erfolgreichen Build erscheint hier der Download.'));
      log.textContent = data.log || 'Noch kein Build-Protokoll.';
      extensions.forEach(extension => extension.update(data.latest ? { name: name(), url: link(data.latest.id), bytes: data.latest.bytes!, sha256: data.latest.sha256! } : undefined));
    } catch (e) { if (!stopped && selected === kind && sequence === request) { error.textContent = (e as Error).message; startButton.disabled = true; } }
  }
  modal = openModal(h('section.dev-apk-dialog', { role: 'dialog', 'aria-label': 'APK', 'aria-modal': 'true' },
    h('header', {}, h('h2', {}, '📦 APK')), h('div.dev-apk-body', {},
      h('p', {}, 'Dev- und Store-Versionen bauen und herunterladen. Unity wird nur auf dem Build-Rechner benötigt.'), h('div.dev-apk-actions', { role: 'group', 'aria-label': 'APK-Variante' }, ...choices), status, latest, current, error, logDetails,
      ...extensions.map(extension => extension.element))), { onClose: () => { stopped = true; clearInterval(timer); off(); extensions.forEach(extension => extension.dispose()); modal = undefined; } });
  const timer = setInterval(() => { void refresh(); }, 2500);
  const off = store.on('floor', () => { if (store.floor !== floor) modal?.close(); });
  void refresh();
}
