import { OperatorClient } from '../../../shared/xr-operator';
import type { QuestDevice } from '../quest-install/device';
import type { XrSnapshot, XrCommand } from '../../../shared/xr-session';
export class BrowserCompanion {
  message='XR Operator wird verbunden…'; active=false;
  private stopped=false; private abort=new AbortController(); private client?:OperatorClient;
  private bridgeId=crypto.randomUUID(); private completed=new Set<string>();
  private results: {id:string;message?:string;error?:string;png?:string}[]=[];
  private operation?:Promise<void>;
  constructor(readonly floor:string,readonly run:string,private token:string,private device:QuestDevice) {}
  private async post(body:Record<string,unknown>) {
    const response=await fetch('/api/playtests/xr-browser?floor='+encodeURIComponent(this.floor),{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({run:this.run,token:this.token,bridgeId:this.bridgeId,...body}),signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(8000)])});
    if(!response.ok){if([401,403,404,409].includes(response.status))this.stopped=true;throw Error((await response.json()).error??'Office-Verbindung unterbrochen');}
    return response.json();
  }
  async start() {
    if(!this.device.operatorFetch||!this.device.serial)throw Error('Browser-Verbindung unterstützt den XR Operator nicht.');
    const client=new OperatorClient('http://127.0.0.1:8720',this.device.operatorFetch);this.client=client;
    try { await client.connect(); }catch(e){client.close();throw e;}
    const devices=[{serial:this.device.serial,name:this.device.name,status:'device'}];
    await this.post({devices,snapshots:{}});
    const r=await fetch('/api/playtests/xr-session?floor='+encodeURIComponent(this.floor),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'select',id:this.run,value:[this.device.serial]}),signal:this.abort.signal});
    if(!r.ok)throw Error((await r.json()).error??'Headset-Auswahl fehlgeschlagen');
    this.active=true;this.operation=this.loop();void this.device.disconnected.then(()=>this.stop(),()=>this.stop());
  }
  private async loop() {
    const serial=this.device.serial!;
    try { while(!this.stopped) {
      try {
        if(!this.client){const c=new OperatorClient('http://127.0.0.1:8720',this.device.operatorFetch!);this.client=c;await c.connect();}
        const start=Date.now(),sample=await this.client.call('ZRB_PlaytestSnapshot') as XrSnapshot;
        if(Date.now()-start>3000)throw Error('Headset-Daten zu alt');
        const reply=await this.post({devices:[{serial,name:this.device.name,status:'device'}],snapshots:{[serial]:sample},results:this.results.slice(0,1)});
        this.results.shift();if(reply.stopped){this.stopped=true;break;}
        for(const command of (reply.commands??[]) as (XrCommand&{expiresInMs:number})[]) {
          if(this.completed.has(command.id)||command.device!==serial||command.expiresInMs<=0)continue;
          this.completed.add(command.id);
          try {
            if(sample.appSession!==command.appSession||sample.context.build!==command.build)throw Error('App oder Build gewechselt');
            if(command.kind==='reserve-ammo'){
              const result=await this.client.call('ZRB_PlaytestPrepare',{payload:JSON.stringify({id:command.id,action:'reserve-ammo',confirmed:true,appSession:command.appSession,build:command.build})});
              if(!result.ok)throw Error(result.error??'Vorbereitung abgelehnt');this.results.push({id:command.id,message:result.message});
            } else if(command.kind==='screenshot') {
              if(!this.device.screenshot)throw Error('Screenshot über diese Verbindung nicht verfügbar');
              const bytes=await this.device.screenshot(AbortSignal.any([this.abort.signal,AbortSignal.timeout(10000)]));
              let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
              this.results.push({id:command.id,png:btoa(binary),message:'Screenshot vom gewählten Headset'});
            }
          } catch(e){this.results.push({id:command.id,error:(e as Error).message.slice(0,500)});}
        }
        await this.client.call('ZRB_PlaytestOverlay',{payload:JSON.stringify(reply.overlays?.[serial]??{status:'stopped'})});
        this.message=`Begleitung aktiv · ${sample.context.mode} · ${sample.context.style} · ${sample.context.build}`;
      } catch(e){this.message=(e as Error).message;this.client?.close();this.client=undefined;}
      if(!this.stopped)await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);this.abort.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,1000);this.abort.signal.addEventListener('abort',done,{once:true});});
    }}finally{this.active=false;await this.release();}
  }
  private async release(){const c=this.client;this.client=undefined;if(c){await c.call('ZRB_PlaytestOverlay',{payload:'{"status":"stopped"}'}).catch(()=>{});c.close();}await this.device.close().catch(()=>{});}
  async stop(){
    const alreadyStopped=this.stopped;this.stopped=true;this.abort.abort();this.client?.close();
    if(this.operation)await this.operation;else await this.release();this.active=false;this.message='Browser-Begleitung beendet.';
    if(!alreadyStopped)await fetch('/api/playtests/xr-session?floor='+encodeURIComponent(this.floor),{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({action:'stop',id:this.run}),signal:AbortSignal.timeout(4000)}).catch(()=>{});
  }
}
