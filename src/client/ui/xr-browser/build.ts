import type { QuestDevice } from '../quest-install/device';
import { apkPackage } from '../quest-install/manifest';
import { installApk, type InstallProgress } from '../quest-install/install';
import { officeApk, type ApkSource } from '../quest-install/source';
export async function latestDevelopment(floor: string, signal: AbortSignal): Promise<ApkSource> {
  const r=await fetch('/api/dev-apk?floor='+encodeURIComponent(floor)+'&kind=development',{credentials:'same-origin',cache:'no-store',signal});
  if(!r.ok)throw Error('Dev-Build konnte nicht geladen werden. Bitte Office-Anmeldung prüfen.');
  const {latest}=await r.json();if(!latest)throw Error('Noch kein erfolgreicher Dev-Build vorhanden. Bitte zuerst im APK-Fenster einen bauen.');
  return officeApk({name:'Dev-APK · '+(latest.revision?.slice(0,12)??latest.id),bytes:latest.bytes,sha256:latest.sha256,url:'/api/dev-apk/download?floor='+encodeURIComponent(floor)+'&kind=development&id='+encodeURIComponent(latest.id)});
}
export async function installedMatches(device: QuestDevice, name: string, sha: string, signal: AbortSignal) {
  const result=await device.shell(['pm','path',name],signal);
  if([0,1].includes(result.exitCode)&&!result.stdout.trim()&&!result.stderr.trim())return false;
  if(result.exitCode!==0)throw Error('Installierter App-Stand konnte nicht gelesen werden: '+result.stderr.slice(0,300));
  const paths=result.stdout.trim().split(/\r?\n/).filter(Boolean);
  if(!paths.length)return false;
  if(paths.length!==1||!/^package:\/data\/app\/[^\r\n]+\.apk$/.test(paths[0]))throw Error('App-Paket nicht eindeutig prüfbar. Split-Installationen werden nicht automatisch ersetzt.');
  const digest=await device.shell(['sha256sum',paths[0].slice(8)],signal);
  if(digest.exitCode||!/^[a-f0-9]{64}\s/i.test(digest.stdout))throw Error('Installierte APK konnte nicht verifiziert werden. Es wurde nichts ersetzt.');
  return digest.stdout.split(/\s/)[0].toLowerCase()===sha.toLowerCase();
}
export async function ensureDevelopment(device: QuestDevice, source: ApkSource, signal: AbortSignal, progress: (p:InstallProgress)=>void) {
  if(!source.sha256)throw Error('Dev-Build-Prüfsumme fehlt.');
  const name=await apkPackage(source,signal);progress({message:'Installierte APK wird mit dem neuesten Dev-Build verglichen…'});
  if(await installedMatches(device,name,source.sha256,signal)){progress({message:'Neuester Dev-Build ist bereits installiert.'});return {name,updated:false};}
  await installApk(device,source,signal,progress);
  if(!await installedMatches(device,name,source.sha256,signal))throw Error('Installierter Build stimmt nach dem Update nicht mit der Dev-APK überein.');
  return {name,updated:true};
}
