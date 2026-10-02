import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_BYTES = 8 * 1024 * 1024;
type Count = { lines: number; binary: boolean };
const empty = (): Count => ({ lines: 0, binary: false });
const signature = (s: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }) =>
  `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
export async function fileSignature(file: string): Promise<string> {
  try { return signature(await stat(file)); } catch { return ''; }
}

/** Cache only unchanged regular files, never follow a link outside its checkout. */
export class UntrackedCounts {
  private entries = new Map<string, { root: string; file: string; sig: string; count: Count }>();
  clear() { this.entries.clear(); }
  retain(root: string, files: Set<string>) {
    for (const [key, entry] of this.entries) if (entry.root === root && !files.has(entry.file)) this.entries.delete(key);
  }
  async read(root: string, file: string): Promise<Count> {
    const key = `${root}\0${file}`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const checkout = await realpath(root);
      const target = await realpath(path.resolve(checkout, file));
      const rel = path.relative(checkout, target);
      if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return empty();
      handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const s = await handle.stat();
      const current = await stat(target);
      if (await realpath(root) !== checkout || await realpath(path.resolve(checkout, file)) !== target || current.dev !== s.dev || current.ino !== s.ino) return empty();
      if (!s.isFile() || s.size > MAX_BYTES) return empty();
      const sig = `${target}:${signature(s)}`;
      const cached = this.entries.get(key);
      if (cached?.sig === sig) return cached.count;
      const buf = Buffer.alloc(s.size);
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      const bytes = buf.subarray(0, bytesRead);
      let count = empty();
      if (bytes.subarray(0, 8000).includes(0)) count = { lines: 0, binary: true };
      else {
        for (const byte of bytes) if (byte === 10) count.lines++;
        if (bytes.length && bytes[bytes.length - 1] !== 10) count.lines++;
      }
      if (signature(await handle.stat()) === signature(s)) {
        if (this.entries.size >= 800) this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(key, { root, file, sig, count });
      }
      return count;
    } catch { this.entries.delete(key); return empty(); }
    finally { await handle?.close(); }
  }
}
