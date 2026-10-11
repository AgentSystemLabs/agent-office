import { OperatorClient } from '../../../shared/xr-operator';
import { h, openModal, closeAllModals } from '../dom';
import { store } from '../../state';
import { availability, requestQuest, type QuestDevice } from '../quest-install/device';
import { explain, launchInstalled } from '../quest-install/install';
import { ensureDevelopment, latestDevelopment } from './build';
import { BrowserCompanion } from './bridge';
import { openXrSession } from '../xr-playtests';
import '../quest-install/ui.css';
import './ui.css';
let companion:BrowserCompanion|undefined;
export function xrBrowserButton(){return h('button.btn.primary',{type:'button',onclick:()=>{closeAllModals();openXrSetup();}},'🥽 XR Operator & Dev-APK');}
export function openXrSetup(){
  const floor=store.floor;if(!floor)return;
  let device:QuestDevice|undefined,busy=false,ready=false,alive=true,operation:Promise<void>|undefined,abort=new AbortController();
  const status=h('p',{role:'status','aria-live':'polite'}),error=h('p.quest-error',{role:'alert'}),progress=h('progress',{max:100,value:0,hidden:true});
  const prepare=h('button.btn.primary',{type:'button',onclick:()=>run(async signal=>{
    status.textContent='Dev-Build wird geladen…';ready=false;
    if(!device){device=await requestQuest(signal,message=>{status.textContent=message;});const connected=device;void device.disconnected.then(()=>{if(device===connected){device=undefined;ready=false;if(alive){status.textContent='Quest getrennt. Bitte erneut verbinden.';render();}}},()=>{});}
    ready=false;
    const source=await latestDevelopment(floor,signal);await ensureDevelopment(device,source,signal,p=>{status.textContent=p.message;progress.hidden=!p.total;if(p.total)progress.value=100*(p.bytes??0)/p.total;});
    ready=true;status.textContent='Neuester Dev-Build bereit. Beim Start werden die XR-Werkzeuge geprüft.';
  })},'Quest verbinden & Dev-APK vorbereiten');
  const start=h('button.btn.primary',{type:'button',onclick:()=>run(async signal=>{
    if(!device)return;
    if(!device.operatorFetch)throw Error('Bitte das Office neu laden. Der USB-Operator-Adapter fehlt.');
    const source=await latestDevelopment(floor,signal);const {name}=await ensureDevelopment(device,source,signal,p=>{status.textContent=p.message;});
    await launchInstalled(device,name,signal);status.textContent='Spiel gestartet. Warte auf XR Operator…';
    // The game needs a moment to initialize the embedded Operator after cold launch.
    let connected=false;
    for(let attempt=0;attempt<8;attempt++){
      signal.throwIfAborted();const client=new OperatorClient('http://127.0.0.1:8720',device.operatorFetch);
      try{await client.connect();connected=true;break;}catch{if(attempt===7)throw Error('XR Operator/ZRB-Werkzeuge fehlen oder sind noch nicht bereit. Prüfe den Dev-Build und öffne das Spiel im Headset.');}finally{client.close();}
      await new Promise<void>(resolve=>setTimeout(resolve,1000));
    }
    if(!connected)return;signal.throwIfAborted();
    const r=await fetch('/api/playtests/xr-session?floor='+encodeURIComponent(floor),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'start'}),signal});
    const data=await r.json();if(!r.ok)throw Error(data.error);
    const bridge=new BrowserCompanion(floor,data.id,data.token,device);
    try{await bridge.start();signal.throwIfAborted();}catch(e){await bridge.stop();await fetch('/api/playtests/xr-session?floor='+encodeURIComponent(floor),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'stop',id:data.id})}).catch(()=>{});device=undefined;ready=false;throw e;}
    companion=bridge;device=undefined;ready=false;
    const off=store.on('floor',()=>{if(store.floor!==floor){off();void bridge.stop();}});
    window.addEventListener('pagehide',()=>{off();void bridge.stop();},{once:true});
    status.textContent='Begleitung läuft für alle passenden Tests. Dieses Browser-Tab geöffnet lassen; das Fenster darf geschlossen werden.';
  })},'Spiel & Testbegleitung starten');
  const details=h('button.btn',{type:'button',onclick:()=>{modal.close();openXrSession();}},'Testlauf & Beobachtungen öffnen');
  const stop=h('button.btn',{type:'button',onclick:()=>run(async()=>{
    const current=companion;if(!current)return;
    const r=await fetch('/api/playtests/xr-session?floor='+encodeURIComponent(current.floor),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'stop',id:current.run})});
    await current.stop();if(!r.ok)throw Error('Browser beendet; den gespeicherten Testlauf bitte unter Beobachtungen beenden.');
  })},'Begleitung beenden');
  const cancel=h('button.btn',{type:'button',onclick:()=>abort.abort()},'Abbrechen');
  function render(){const active=!!companion?.active;prepare.disabled=busy||active||!!availability();start.disabled=busy||active||!ready;stop.hidden=!active;cancel.hidden=!busy;if(active)status.textContent=companion!.message;}
  function run(task:(signal:AbortSignal)=>Promise<void>){if(busy)return;busy=true;abort=new AbortController();error.textContent='';render();operation=(async()=>{try{await task(abort.signal);}catch(e){if(alive)error.textContent=abort.signal.aborted?'Abgebrochen. Den tatsächlichen App-Stand auf der Quest prüfen.':explain(e);}finally{busy=false;progress.hidden=true;if(alive)render();}})();}
  const root=h('div.modal.xr-modal.xr-browser-modal',{role:'dialog','aria-label':'XR Operator & Dev-APK'},h('header',{},h('h2',{},'🥽 XR Operator & Dev-APK')),
    h('div.xr-body',{},h('p',{},'Vorbereitung für deine ganze Spielsession: neueste erfolgreiche Dev-APK prüfen und bei Abweichung installieren. Der XR Operator steckt im Dev-Build. Deine bisherigen Test-Häkchen bleiben erhalten.'),
      h('p',{},'Chrome/Edge, USB-Datenkabel, Quest-Entwicklermodus und USB-Debugging erforderlich. Verbunden wird die Quest an diesem Rechner, auch beim entfernten Tester.'),
      availability()?h('p.quest-error',{},availability()!):null,status,error,progress,h('div.quest-actions',{},prepare,start,cancel),
      h('p',{},'Die Begleitung folgt automatisch Modus, Solo/Koop und Spielphase. Sie läuft bei geschlossenem Fenster weiter, solange dieses Browser-Tab und die USB-Verbindung offen bleiben. Für zwei Headsets steht unter Testlauf weiterhin der PC-Helfer zur Verfügung.'),h('div.quest-actions',{},details,stop)));
  const timer=setInterval(render,1000);const modal=openModal(root,{doing:'preparing headset playtests',onClose:()=>{alive=false;abort.abort();clearInterval(timer);offFloor();void (async()=>{await operation;await device?.close().catch(()=>{});})();}});
  const offFloor=store.on('floor',()=>{if(store.floor!==floor)modal.close();});render();
}
