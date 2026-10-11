export interface OfficeApk { name: string; url: string; bytes: number; sha256: string }
export interface ApkSource {
  name: string; size: number; sha256?: string;
  read(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array>;
  stream(signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}
export function localApk(file: File): ApkSource {
  if (!file.name.toLowerCase().endsWith('.apk')) throw Error('Bitte eine APK-Datei auswählen.');
  return { name: file.name, size: file.size,
    async read(offset, length, signal) { signal.throwIfAborted(); const data = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()); signal.throwIfAborted(); return data; },
    async stream(signal) { signal.throwIfAborted(); return file.stream(); } };
}
export function officeApk(apk: OfficeApk, origin = location.origin): ApkSource {
  const url = new URL(apk.url, origin);
  if (url.origin !== origin || url.pathname !== '/api/dev-apk/download' || !url.searchParams.get('id')) throw Error('Ungültiger Office-Build. Bitte aktualisieren.');
  if (!Number.isSafeInteger(apk.bytes) || apk.bytes < 22 || !/^[a-f0-9]{64}$/i.test(apk.sha256)) throw Error('Build-Metadaten fehlen. Bitte aktualisieren.');
  const request = async (signal: AbortSignal, range?: string) => {
    const r = await fetch(url, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal, headers: range ? { Range: range } : {} });
    if (r.status === 401 || r.status === 403) throw Error('Bitte erneut im Office anmelden.');
    if (r.status !== (range ? 206 : 200)) { await r.body?.cancel(); throw Error('APK nicht verfügbar oder Download unterbrochen. Bitte aktualisieren und erneut versuchen.'); }
    return r;
  };
  return { name: apk.name, size: apk.bytes, sha256: apk.sha256.toLowerCase(),
    async read(offset, length, signal) {
      if (offset < 0 || length < 1 || offset + length > apk.bytes) throw Error('Ungültiger APK-Dateibereich.');
      const r = await request(signal, `bytes=${offset}-${offset + length - 1}`);
      if (r.headers.get('content-range') !== `bytes ${offset}-${offset + length - 1}/${apk.bytes}`) { await r.body?.cancel(); throw Error('APK-Dateibereich wurde vom Server nicht korrekt geliefert.'); }
      const data = new Uint8Array(await r.arrayBuffer()); if (data.length !== length) throw Error('APK-Download unvollständig.'); return data;
    },
    async stream(signal) {
      const r = await request(signal);
      if (!r.body || Number(r.headers.get('content-length')) !== apk.bytes) { await r.body?.cancel(); throw Error('Die APK-Größe stimmt nicht mit dem ausgewählten Build überein.'); }
      return r.body;
    } };
}
