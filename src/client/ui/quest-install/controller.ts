import { requestQuest, type QuestDevice } from './device';
import { explain, installApk, launchInstalled, type InstallProgress } from './install';
import type { ApkSource } from './source';
export interface QuestState extends InstallProgress { busy: boolean; connected?: string; installed?: string; error?: string; source?: string }
export class QuestInstaller {
  state: QuestState = { busy: false, message: 'Quest per USB mit diesem Rechner verbinden.' };
  private device?: QuestDevice;
  private abort?: AbortController;
  private operation?: Promise<void>;
  private disposed = false;
  constructor(private changed: (state: QuestState) => void, private connectDevice = requestQuest) {}
  private update(value: Partial<QuestState>) { this.state = {...this.state,...value}; if (!this.disposed) this.changed(this.state); }
  private run(task: (signal: AbortSignal) => Promise<void>) {
    if (this.state.busy || this.disposed) return Promise.resolve();
    this.abort = new AbortController(); const signal = this.abort.signal;
    this.update({ busy: true, error: undefined, bytes: undefined, total: undefined });
    return this.operation = (async () => {
      try { await task(signal); }
      catch (e) { this.update({ error: signal.aborted ? 'Abgebrochen. Falls Android bereits installiert hat, bitte den App-Stand auf der Quest prüfen.' : explain(e), message: 'Vorgang beendet.' }); }
      finally { this.abort = undefined; this.update({busy:false}); }
    })();
  }
  connect() {
    return this.run(async signal => {
      const old = this.device; this.device = undefined; this.update({connected:undefined,installed:undefined,source:undefined});
      if (old) await old.close().catch(() => {});
      const device = await this.connectDevice(signal, message => this.update({message}));
      if (signal.aborted || this.disposed) { await device.close(); signal.throwIfAborted(); return; }
      this.device = device; this.update({connected:device.name,message:'Quest verbunden. Wähle die APK zum Installieren.'});
      const disconnected = () => { if (this.device !== device) return; this.device = undefined; this.abort?.abort(); this.update({connected:undefined,installed:undefined,message:'Quest getrennt. Bitte erneut verbinden.'}); };
      void device.disconnected.then(disconnected, disconnected);
    });
  }
  install(source: ApkSource) {
    return this.run(async signal => {
      const device = this.device; if (!device) throw Error('Bitte zuerst die Quest verbinden.');
      this.update({ installed: undefined, source: source.name });
      const installed = await installApk(device, source, signal, value => this.update(value));
      if (this.device !== device) throw Error('Quest wurde getrennt.');
      this.update({installed,bytes:undefined,total:undefined});
    });
  }
  launch() {
    return this.run(async signal => {
      if (!this.device || !this.state.installed) throw Error('Bitte zuerst eine APK erfolgreich installieren.');
      this.update({message:'Spiel wird gestartet…'});
      await launchInstalled(this.device,this.state.installed,signal); this.update({message:'Spiel gestartet. Setze dein Headset auf.'});
    });
  }
  cancel() { this.abort?.abort(); }
  async disconnect() { this.cancel(); await this.operation; const device = this.device; this.device = undefined; await device?.close().catch(()=>{}); this.update({connected:undefined,installed:undefined,message:'Quest getrennt.'}); }
  async dispose() { this.disposed = true; await this.disconnect(); }
}
