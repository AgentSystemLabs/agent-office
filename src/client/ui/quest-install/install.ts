import { apkPackage, validPackage } from './manifest';
import type { ApkSource } from './source';
import type { QuestDevice } from './device';
export interface InstallProgress { message: string; bytes?: number; total?: number }
export function explain(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/i.test(text)) return 'Die vorhandene App hat eine andere Signatur. Es wurde nichts deinstalliert. Verwende eine passend signierte APK; eine Deinstallation würde App-Daten löschen.';
  if (/INSTALL_FAILED_VERSION_DOWNGRADE/i.test(text)) return 'Auf der Quest ist eine neuere Version installiert. Bitte einen neueren Build verwenden. Es wurde kein Downgrade erzwungen.';
  if (/INSTALL_FAILED_INSUFFICIENT_STORAGE|ENOSPC|No space left/i.test(text)) return 'Auf der Quest fehlt Speicherplatz. Bitte Platz freigeben und erneut versuchen.';
  if (/DeviceBusy|Unable to claim|already in use|claimInterface/i.test(text)) return 'Die USB-Verbindung wird bereits verwendet oder ist nicht verfügbar. SideQuest, Meta Quest Developer Hub und andere ADB-Verbindungen schließen. Unter Windows gegebenenfalls den Meta-ADB-Treiber prüfen.';
  if (/transfer|disconnected|device was lost|NetworkError/i.test(text)) return 'USB-Verbindung unterbrochen. Kabel und Headset prüfen und erneut verbinden. Falls Android schon installiert hat, den App-Stand auf der Quest prüfen.';
  return text.slice(0, 2000);
}
export async function installApk(device: QuestDevice, source: ApkSource, signal: AbortSignal, progress: (value: InstallProgress) => void): Promise<string> {
  signal.throwIfAborted(); progress({message: 'APK wird geprüft…'});
  const packageName = await apkPackage(source, signal), path = '/data/local/tmp/office-apk-' + crypto.randomUUID() + '.apk';
  signal.throwIfAborted();
  try {
    await device.push(path, source, signal, bytes => progress({message: 'APK wird auf die Quest übertragen…', bytes, total: source.size}));
    signal.throwIfAborted();
    if (source.sha256) {
      progress({message: 'Übertragene APK wird verifiziert…'});
      const result = await device.shell(['sha256sum', path], signal);
      if (result.exitCode || result.stdout.trim().split(/\s+/)[0]?.toLowerCase() !== source.sha256) throw Error('Die Prüfsumme stimmt nicht. Die APK wurde nicht installiert. Bitte erneut versuchen.');
    }
    progress({message: 'Android installiert die APK. Bitte USB angeschlossen lassen…'});
    const result = await device.shell(['pm', 'install', '-r', '-t', path], signal);
    if (result.exitCode !== 0 || !/^Success\s*$/m.test(result.stdout) || /Failure\s*\[/.test(result.stdout + result.stderr)) throw Error((result.stdout + '\n' + result.stderr).trim() || 'Android hat die Installation nicht bestätigt.');
    signal.throwIfAborted(); progress({message: 'APK erfolgreich installiert.'}); return packageName;
  } finally {
    // Only the unique temporary APK from this attempt; never uninstall or remove app data.
    await device.shell(['rm', '-f', path], AbortSignal.timeout(5000)).catch(() => {});
  }
}
export async function launchInstalled(device: QuestDevice, packageName: string, signal: AbortSignal) {
  if (!validPackage(packageName)) throw Error('Keine erfolgreich installierte App ausgewählt.');
  let component: string | undefined;
  for (const category of ['android.intent.category.LAUNCHER', 'android.intent.category.INFO']) {
    const result = await device.shell(['cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', category, packageName], signal);
    component = result.stdout.trim().split(/\r?\n/).find(line => line.startsWith(packageName + '/') && /^[A-Za-z0-9_.$/]+$/.test(line));
    if (!result.exitCode && component) break; component = undefined;
  }
  if (!component) throw Error('Kein startbarer Eintrag gefunden. Öffne die App über die Bibliothek im Headset.');
  const result = await device.shell(['am', 'start', '-a', 'android.intent.action.MAIN', '-n', component], signal);
  if (result.exitCode || /Error|Exception/i.test(result.stdout + result.stderr)) throw Error((result.stdout + '\n' + result.stderr).trim() || 'App konnte nicht gestartet werden.');
}
