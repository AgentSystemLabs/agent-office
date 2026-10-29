import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EditorialDatabase } from './db.js';

export interface EditorialBackupManifest {
  format: 1;
  createdAt: string;
  sourceEditorialDir: string;
  files: string[];
}

/**
 * Creates a self-contained copy of the private editorial database and file store. The database is
 * checkpointed before copying so a restore does not depend on a live WAL sidecar.
 */
export function backupEditorial(dataDir: string, destination: string, checkpoint = true): EditorialBackupManifest {
  const source = path.resolve(dataDir, 'editorial');
  const target = path.resolve(destination);
  if (target === source || target.startsWith(`${source}${path.sep}`)) throw new Error('Backup destination cannot be inside the source editorial directory');
  if (!existsSync(source)) throw new Error(`Editorial directory does not exist: ${source}`);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const databasePath = path.join(source, 'editorial.sqlite');
  if (checkpoint && existsSync(databasePath)) {
    const database = new EditorialDatabase(databasePath);
    try { database.checkpoint(); } finally { database.close(); }
  }
  cpSync(source, target, { recursive: true, force: true, preserveTimestamps: true });
  const files = listFiles(target).map((file) => path.relative(target, file));
  const manifest: EditorialBackupManifest = { format: 1, createdAt: new Date().toISOString(), sourceEditorialDir: source, files };
  // This is metadata, not user content; it makes a copied directory auditable without secrets.
  const manifestPath = path.join(target, 'BACKUP-MANIFEST.json');
  requireSafeManifestPath(manifestPath, target);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return manifest;
}

/** Restores into a separate data directory by default; `force` is required to overwrite an existing database. */
export function restoreEditorialBackup(backupDirectory: string, dataDir: string, force = false): void {
  const source = path.resolve(backupDirectory);
  const target = path.resolve(dataDir, 'editorial');
  const databasePath = path.join(source, 'editorial.sqlite');
  if (!existsSync(source) || !existsSync(databasePath) || !statSync(databasePath).isFile()) throw new Error('Backup must contain editorial.sqlite');
  if (existsSync(path.join(target, 'editorial.sqlite')) && !force) throw new Error(`Destination already contains an editorial database: ${target}; pass --force only when replacement is intended`);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  cpSync(source, target, { recursive: true, force: true, preserveTimestamps: true });
}

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry: { name: string; isDirectory(): boolean }) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

function requireSafeManifestPath(filePath: string, root: string): void {
  if (!filePath.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Backup manifest path escaped destination');
}

