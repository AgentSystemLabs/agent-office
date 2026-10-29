import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const AREAS = new Set(['originals', 'sources', 'derived', 'renderings', 'packages', 'reports', 'social']);

export interface StoredFile {
  path: string;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
}

export class EditorialStorage {
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }

  projectRoot(projectId: string, editionId?: string): string {
    const ids = [projectId, editionId].filter(Boolean) as string[];
    if (ids.some((id) => !/^[a-zA-Z0-9_-]+$/.test(id))) throw new Error('Unsafe storage identifier');
    const target = path.resolve(this.root, 'projects', ...ids);
    if (!target.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Storage path escaped root');
    mkdirSync(target, { recursive: true, mode: 0o700 });
    return target;
  }

  write(projectId: string, area: string, extension: string, data: string | Uint8Array, editionId?: string): StoredFile {
    if (!AREAS.has(area)) throw new Error(`Unknown artifact area: ${area}`);
    const safeExtension = extension.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'bin';
    const base = this.projectRoot(projectId, editionId);
    const dir = path.join(base, area);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const relativePath = path.relative(this.root, path.join(dir, `${randomUUID()}.${safeExtension}`));
    const filePath = path.resolve(this.root, relativePath);
    if (!filePath.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Storage path escaped root');
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    const temp = `${filePath}.${randomUUID()}.tmp`;
    writeFileSync(temp, bytes, { mode: 0o600 });
    renameSync(temp, filePath);
    return { path: filePath, relativePath, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.byteLength };
  }

  read(relativePath: string): Buffer {
    const filePath = path.resolve(this.root, relativePath);
    if (!filePath.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Artifact path escaped root');
    return readFileSync(filePath);
  }
}
