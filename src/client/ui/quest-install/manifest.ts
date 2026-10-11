import { inflateSync } from 'fflate';
import type { ApkSource } from './source';
const MAX_MANIFEST = 8 * 1024 * 1024;
const bad = () => Error('Die APK enthält kein gültiges Android-Manifest. Bitte eine vollständige APK auswählen.');
export const validPackage = (value: string) => /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(value) && value.length < 256;
/** Read only the ZIP directory and bounded manifest, even for multi-GB game APKs. */
export async function apkPackage(source: ApkSource, signal: AbortSignal): Promise<string> {
  if (source.size < 22 || source.size > 0xffffffff) throw bad();
  const tail = await source.read(Math.max(0, source.size - 65557), Math.min(source.size, 65557), signal);
  const t = new DataView(tail.buffer, tail.byteOffset, tail.byteLength); let end = -1;
  for (let p = tail.length - 22; p >= 0; p--) if (t.getUint32(p, true) === 0x06054b50 && p + 22 + t.getUint16(p + 20, true) === tail.length) { end = p; break; }
  if (end < 0 || t.getUint16(end + 4, true) || t.getUint16(end + 6, true)) throw bad();
  const count = t.getUint16(end + 10, true), size = t.getUint32(end + 12, true), offset = t.getUint32(end + 16, true);
  if (count === 65535 || size > 32 * 1024 * 1024 || offset + size > source.size - 22 || !size) throw bad();
  const directory = await source.read(offset, size, signal), d = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  let entry: { offset: number; compressed: number; size: number; method: number } | undefined;
  for (let p = 0, n = 0; n < count; n++) {
    if (p + 46 > size || d.getUint32(p, true) !== 0x02014b50) throw bad();
    const nameSize = d.getUint16(p + 28, true), next = p + 46 + nameSize + d.getUint16(p + 30, true) + d.getUint16(p + 32, true);
    if (next > size) throw bad();
    if (new TextDecoder().decode(directory.subarray(p + 46, p + 46 + nameSize)) === 'AndroidManifest.xml') {
      if (entry || (d.getUint16(p + 8, true) & 1)) throw bad();
      entry = { offset: d.getUint32(p + 42, true), compressed: d.getUint32(p + 20, true), size: d.getUint32(p + 24, true), method: d.getUint16(p + 10, true) };
    }
    p = next;
  }
  if (!entry || ![0,8].includes(entry.method) || entry.size > MAX_MANIFEST || entry.compressed > MAX_MANIFEST || entry.size < 8 || entry.offset + 30 > offset) throw bad();
  const header = await source.read(entry.offset, 30, signal), h = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (h.getUint32(0, true) !== 0x04034b50 || h.getUint16(8, true) !== entry.method || (h.getUint16(6, true) & 1)) throw bad();
  const start = entry.offset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  if (start + entry.compressed > offset || !entry.compressed) throw bad();
  const zipped = await source.read(start, entry.compressed, signal);
  const xml = entry.method === 0 ? zipped : inflateSync(zipped, { out: new Uint8Array(entry.size) });
  if (xml.length !== entry.size) throw bad();
  return manifestPackage(xml);
}
export function manifestPackage(xml: Uint8Array): string {
  try {
    const d = new DataView(xml.buffer, xml.byteOffset, xml.byteLength);
    if (d.getUint16(0, true) !== 3 || d.getUint16(2, true) !== 8 || d.getUint32(4, true) !== xml.length) throw bad();
    let strings: string[] = [];
    for (let p = 8; p < xml.length;) {
      const type = d.getUint16(p, true), header = d.getUint16(p + 2, true), size = d.getUint32(p + 4, true), end = p + size;
      if (header < 8 || size < header || end > xml.length) throw bad();
      if (type === 1) {
        if (header < 28) throw bad();
        const count = d.getUint32(p + 8, true), utf8 = !!(d.getUint32(p + 16, true) & 0x100), start = p + d.getUint32(p + 20, true);
        if (count > 100000 || p + header + count * 4 > start || start > end) throw bad();
        strings = [];
        for (let i = 0; i < count; i++) {
          let at = start + d.getUint32(p + header + i * 4, true);
          const length = () => {
            if (at + (utf8 ? 1 : 2) > end) throw bad();
            let n = utf8 ? d.getUint8(at++) : d.getUint16(at, true); if (!utf8) at += 2;
            const flag = utf8 ? 0x80 : 0x8000;
            if (n & flag) { if (at + (utf8 ? 1 : 2) > end) throw bad(); n = (n & (flag - 1)) * (utf8 ? 256 : 65536) + (utf8 ? d.getUint8(at++) : d.getUint16(at, true)); if (!utf8) at += 2; } return n;
          };
          let n = length(); if (utf8) n = length(); else n *= 2;
          if (at < start || at + n + (utf8 ? 1 : 2) > end) throw bad();
          strings.push(new TextDecoder(utf8 ? 'utf-8' : 'utf-16le', { fatal: true }).decode(xml.subarray(at, at + n)));
        }
      } else if (type === 0x0102) {
        if (header !== 16 || size < 36) throw bad();
        const at = p + 16, name = strings[d.getUint32(at + 4, true)], first = at + d.getUint16(at + 8, true), step = d.getUint16(at + 10, true), count = d.getUint16(at + 12, true);
        if (step < 20 || first < at + 20 || first + count * step > end) throw bad();
        if (name === 'manifest') for (let i = 0; i < count; i++) {
          const a = first + i * step;
          if (d.getUint32(a, true) !== 0xffffffff || strings[d.getUint32(a + 4, true)] !== 'package') continue;
          const raw = d.getUint32(a + 8, true), value = strings[raw === 0xffffffff && d.getUint8(a + 15) === 3 ? d.getUint32(a + 16, true) : raw];
          if (!value || !validPackage(value)) throw bad(); return value;
        }
      }
      p = end;
    }
  } catch { throw bad(); }
  throw bad();
}
