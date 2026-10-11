import './ui.css';
import { h } from '../dom';
import { availability } from './device';
import { QuestInstaller } from './controller';
import { localApk, officeApk, type ApkSource, type OfficeApk } from './source';
export interface ApkExtension { element: HTMLElement; update(apk?: OfficeApk): void; dispose(): void }
export function questInstallPanel(): ApkExtension {
  let selected: ApkSource | undefined, latest: OfficeApk | undefined;
  const unsupported = availability(), status = h('p', {role:'status','aria-live':'polite'}), error = h('p.quest-error', {role:'alert'});
  const device = h('strong'), source = h('p'), chosen = h('p', {}, 'Keine lokale APK ausgewählt.');
  const progress = h('progress', { max: 100, value: 0, 'aria-label':'APK übertragen' }), amount = h('span');
  const controller = new QuestInstaller(render);
  const connect = h('button.btn', {type:'button',onclick:()=>void controller.connect()}, 'Quest verbinden');
  const disconnect = h('button.btn', {type:'button',onclick:()=>void controller.disconnect()}, 'Trennen');
  const installLatest = h('button.btn.primary', {type:'button',onclick:()=>{
    if (!latest) return; try { void controller.install(officeApk(latest)); } catch(e) { error.textContent=(e as Error).message; }
  }}, 'Neueste APK installieren');
  const file = h('input', {type:'file',accept:'.apk,application/vnd.android.package-archive',hidden:true,'aria-label':'APK-Datei',onchange:()=>{
    if (controller.state.busy || !file.files?.[0]) return;
    try { selected = localApk(file.files[0]); chosen.textContent = selected.name; }
    catch(e) { selected = undefined; render(); error.textContent=(e as Error).message; return; } render(); file.value='';
  }});
  const pick = h('button.btn', {type:'button',onclick:()=>file.click()}, 'APK-Datei auswählen');
  const installFile = h('button.btn', {type:'button',onclick:()=>{if(selected)void controller.install(selected);}}, 'Ausgewählte APK installieren');
  const launch = h('button.btn.primary', {type:'button',onclick:()=>void controller.launch()}, 'Spiel starten');
  const cancel = h('button.btn', {type:'button',onclick:()=>controller.cancel()}, 'Abbrechen');
  function render() {
    const s = controller.state;
    device.textContent = s.connected ? 'Verbunden: '+s.connected : 'Keine Quest verbunden'; status.textContent = s.message; error.textContent = s.error ?? '';
    source.textContent = s.source ? 'APK: '+s.source : '';
    connect.disabled = !!unsupported || s.busy || !!s.connected; disconnect.disabled = !s.connected || s.busy;
    installLatest.disabled = !!unsupported || !s.connected || !latest || s.busy;
    installLatest.textContent = latest ? latest.name+' installieren' : 'Neueste APK installieren';
    pick.disabled = s.busy; installFile.disabled = !!unsupported || !s.connected || !selected || s.busy;
    launch.disabled = !s.connected || !s.installed || s.busy; cancel.hidden = !s.busy;
    progress.hidden = !s.busy || !s.total; amount.hidden = progress.hidden;
    if(s.total){progress.value = Math.min(100,100*(s.bytes??0)/s.total);amount.textContent=`${Math.round((s.bytes??0)/1048576)} / ${Math.round(s.total/1048576)} MB`;}
  }
  const element = h('section.quest-installer', {'aria-label':'Auf Quest installieren'},h('h3',{},'Auf Quest installieren'),
    h('p',{},'Die Quest muss an diesem Rechner angeschlossen sein – auch wenn das Office bei jemand anderem läuft.'),
    h('details',{},h('summary',{},'Einmalige Einrichtung & Verbindungshilfe'),h('ol',{},
      h('li',{},'Office in Chrome oder Edge über HTTPS öffnen.'),h('li',{},'Entwicklermodus für die Quest aktivieren und ein USB-Datenkabel anschließen.'),
      h('li',{},'„Quest verbinden“ drücken, das Gerät auswählen und im Headset USB-Debugging zulassen.'),
      h('li',{},'Wenn die Verbindung belegt ist: SideQuest, Meta Quest Developer Hub und andere ADB-Programme schließen. Unter Windows gegebenenfalls den Meta-ADB-Treiber installieren.')),
      h('p',{},'Der Verbindungsschlüssel bleibt in diesem Browser. Bei einem Signaturkonflikt bleibt die vorhandene App erhalten. Es werden keine App-Daten gelöscht und keine Downgrades erzwungen.')),
    unsupported ? h('p.quest-error',{},unsupported) : null,device,
    h('div.quest-actions',{},connect,disconnect), h('div.quest-actions',{},installLatest),
    h('div.quest-actions',{},pick,file,installFile),chosen,source,status,error,h('div.quest-progress',{},progress,amount),h('div.quest-actions',{},launch,cancel));
  render();
  return { element,update(apk){latest=apk;render();},dispose(){void controller.dispose();} };
}
