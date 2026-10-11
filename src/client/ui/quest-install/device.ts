import { Adb, AdbDaemonTransport } from '@yume-chan/adb';
import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';
import { ReadableStream as AdbReadableStream } from '@yume-chan/stream-extra';
import type { ApkSource } from './source';
export interface ShellResult { stdout: string; stderr: string; exitCode: number }
export interface QuestDevice {
  name: string; disconnected: Promise<void>;
  push(path: string, source: ApkSource, signal: AbortSignal, progress: (bytes: number) => void): Promise<void>;
  shell(args: string[], signal: AbortSignal): Promise<ShellResult>;
  close(): Promise<void>;
}
export function availability(): string | undefined {
  if (!globalThis.isSecureContext) return 'Bitte das Office über HTTPS oder localhost öffnen.';
  if (!AdbDaemonWebUsbDeviceManager.BROWSER) return 'USB-Installation benötigt Chrome oder Edge auf deinem Rechner. Firefox und Safari unterstützen diese Verbindung nicht.';
}
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export async function requestQuest(signal: AbortSignal, status: (text: string) => void): Promise<QuestDevice> {
  const unavailable = availability(); if (unavailable) throw Error(unavailable);
  // Must run immediately in the connect button's user gesture, before any network request or lazy import.
  const device = await AdbDaemonWebUsbDeviceManager.BROWSER!.requestDevice({ filters: [{ vendorId: 0x2833 }] });
  signal.throwIfAborted(); if (!device) throw Error('Keine Quest ausgewählt.');
  const cancel = () => { void device.raw.close().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    status('Verbindung wird geöffnet…'); const connection = await device.connect(); signal.throwIfAborted();
    status('Bitte im Headset „USB-Debugging zulassen“ bestätigen.');
    const transport = await AdbDaemonTransport.authenticate({ serial: device.serial, connection, credentialStore: new AdbWebCredentialStore('Agent Office'), readTimeLimit: 120000 });
    const adb = new Adb(transport);
    if (signal.aborted) { await adb.close(); signal.throwIfAborted(); }
    return new UsbQuest(adb, device.name || adb.banner.model || 'Meta Quest');
  } catch (e) { cancel(); throw e; }
  finally { signal.removeEventListener('abort', cancel); }
}
class UsbQuest implements QuestDevice {
  readonly disconnected: Promise<void>;
  constructor(private adb: Adb, public name: string) { this.disconnected = adb.disconnected; }
  close() { return this.adb.close(); }
  async push(path: string, source: ApkSource, signal: AbortSignal, progress: (bytes: number) => void) {
    signal.throwIfAborted(); const sync = await this.adb.sync();
    const cancel = () => { void sync.dispose().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted(); let sent = 0;
      const reader = (await source.stream(signal)).getReader();
      const abortRead = () => { void reader.cancel(signal.reason).catch(() => {}); };
      signal.addEventListener('abort', abortRead, { once: true });
      try {
        const stream = new AdbReadableStream<Uint8Array>({ async pull(controller) {
          signal.throwIfAborted(); const {done,value} = await reader.read(); signal.throwIfAborted();
          if (done) { if (sent !== source.size) throw Error('APK-Übertragung unvollständig.'); controller.close(); return; }
          sent += value.length; if (sent > source.size) throw Error('Die APK ist größer als erwartet.'); progress(sent); controller.enqueue(value);
        }, cancel: () => reader.cancel() });
        await sync.write({ filename: path, file: stream, permission: 0o600 }); signal.throwIfAborted();
      } finally { signal.removeEventListener('abort', abortRead); await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } finally { signal.removeEventListener('abort', cancel); await sync.dispose().catch(() => {}); }
  }
  async shell(args: string[], signal: AbortSignal): Promise<ShellResult> {
    const shell = this.adb.subprocess.shellProtocol; if (!shell) throw Error('Die Quest unterstützt die benötigte ADB-Verbindung nicht.');
    const proc = await shell.spawn(args.map(quote), signal);
    const read = async (stream: typeof proc.stdout) => {
      const reader = stream.getReader(), decoder = new TextDecoder(); let value = '';
      try { while (true) { const {done, value: chunk} = await reader.read(); if (done) break; value += decoder.decode(chunk, { stream: true }); if (value.length > 65536) throw Error('Unerwartet große Geräteantwort.'); } return value + decoder.decode(); }
      finally { reader.releaseLock(); }
    };
    try { const [stdout, stderr, exitCode] = await Promise.all([read(proc.stdout), read(proc.stderr), proc.exited]); signal.throwIfAborted(); return { stdout, stderr, exitCode }; }
    catch (e) { await proc.kill(); throw e; }
  }
}
