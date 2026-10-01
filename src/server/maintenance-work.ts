import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { GhIssue, MaintenanceAttachment, MaintenanceWorkItem, WorkerInfo } from '../shared/protocol.js';
import { maintenanceQueued } from '../shared/maintenance-issues.js';
import { dropName } from './drops.js';

export const MAINTENANCE_IMAGE_MAX = 10 * 1024 * 1024;
export const MAINTENANCE_IMAGE_COUNT = 4;

/** Durable screenshots are independent of workers: ending a session must not erase evidence. */
export class MaintenanceImages {
  private dir: string;
  constructor(dataDir: string) { this.dir = path.join(dataDir, 'maintenance', 'images'); mkdirSync(this.dir, { recursive: true }); }
  save(name: string, type: string, body: Buffer): MaintenanceAttachment {
    const valid = type === 'image/png' ? body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : type === 'image/jpeg' ? body[0] === 255 && body[1] === 216 && body[2] === 255
      : type === 'image/webp' ? body.subarray(0, 4).toString() === 'RIFF' && body.subarray(8, 12).toString() === 'WEBP'
      : type === 'image/gif' ? /^GIF8[79]a$/.test(body.subarray(0, 6).toString()) : false;
    if (!valid || !body.length || body.length > MAINTENANCE_IMAGE_MAX) throw new Error('Use a PNG, JPEG, WebP or GIF image, up to 10 MB.');
    const image = { id: randomUUID(), name: dropName(name, type), type, size: body.length };
    writeFileSync(path.join(this.dir, image.id + ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[type] ?? '.png')), body, { mode: 0o600, flag: 'wx' });
    writeFileSync(path.join(this.dir, image.id + '.json'), JSON.stringify(image), { mode: 0o600, flag: 'wx' });
    return image;
  }
  get(id: string): MaintenanceAttachment & { path: string } {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Bad image ID');
    const image = JSON.parse(readFileSync(path.join(this.dir, id + '.json'), 'utf8')) as MaintenanceAttachment;
    return { ...image, path: path.join(this.dir, id + ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[image.type] ?? '.png')) };
  }
  resolve(ids: string[]): MaintenanceAttachment[] {
    if (!Array.isArray(ids) || ids.length > MAINTENANCE_IMAGE_COUNT || ids.some(id => typeof id !== 'string')) throw new Error('Attach up to four images.');
    return [...new Set(ids)].map(id => { const { path: _path, ...image } = this.get(id); return image; });
  }
  prompt(text: string, images: MaintenanceAttachment[]) {
    return images.length ? `${text}\n\n[Maintenance images]\nOpen these local image files with your image-reading tools before responding:\n${images.map(i => `${this.get(i.id).path} (${i.name})`).join('\n')}` : text;
  }
}

/** A serial, human-dispatched issue queue. Work is never injected into a busy agent's terminal. */
export class MaintenanceWork {
  private file: string;
  private items: MaintenanceWorkItem[] = [];
  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'maintenance-work.json');
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8'));
      if (Array.isArray(saved)) this.items = saved.filter(i => i && Number.isSafeInteger(i.number) && i.number > 0 && typeof i.repo === 'string' && typeof i.title === 'string' && typeof i.url === 'string' && Array.isArray(i.attachments) && Array.isArray(i.commits) && ['queued', 'running', 'review', 'paused', 'done'].includes(i.status));
    } catch { /* Empty on first run. */ }
  }
  list(repo?: string) { return this.items.filter(i => !repo || i.repo.toLowerCase() === repo.toLowerCase()); }
  get(repo: string, number: number) { return this.list(repo).find(i => i.number === number); }
  /** Reconcile only successful GitHub snapshots; a failed refresh must not erase the queue. */
  syncIssues(repo: string, issues: GhIssue[]) {
    const before = JSON.stringify(this.items);
    for (const issue of issues) {
      let item = this.get(repo, issue.number);
      if (!item && maintenanceQueued(issue)) {
        item = this.queue(repo, issue, issue.author || 'GitHub');
      }
      if (!item) continue;
      Object.assign(item, { title: issue.title, url: issue.url, issueState: issue.state });
      if (issue.state !== 'OPEN') item.status = 'done';
      else if (maintenanceQueued(issue) && item.status !== 'running') item.status = 'queued';
      else if (!maintenanceQueued(issue) && item.status === 'queued') {
        item.status = 'paused';
      }
    }
    // Waiting issues absent from the open snapshot cannot be dispatched from a stale local cache.
    for (const item of this.list(repo)) {
      if (item.status === 'queued' && !issues.some(issue => issue.number === item.number && maintenanceQueued(issue))) item.status = 'paused';
    }
    if (before !== JSON.stringify(this.items)) this.save();
  }
  queue(repo: string, issue: { number: number; title: string; url: string }, by: string, attachments: MaintenanceAttachment[] = []) {
    const old = this.get(repo, issue.number);
    if (old && ['queued', 'running'].includes(old.status)) {
      Object.assign(old, { title: issue.title, url: issue.url, ...(attachments.length ? { attachments } : {}) }); this.save(); return old;
    }
    const item: MaintenanceWorkItem = { number: issue.number, title: issue.title, url: issue.url, repo, status: 'queued', by, at: Date.now(), attachments: attachments.length ? attachments : old?.attachments ?? [], commits: [] };
    this.items = [...this.items.filter(i => i !== old), item];
    this.save(); return item;
  }
  remove(repo: string, number: number) {
    const item = this.get(repo, number);
    if (item?.status === 'running') throw new Error('Finish or end the active session before removing it.');
    this.items = this.items.filter(i => i !== item); this.save();
  }
  reviewed(repo: string, number: number) {
    const item = this.get(repo, number);
    if (!item || item.status !== 'review') throw new Error('Only completed agent turns can be marked reviewed');
    item.status = 'done'; this.save();
  }
  start(repo: string, number: number, worker: WorkerInfo, baseline: string[]) {
    if (this.list(repo).some(i => i.status === 'running')) throw new Error('Another maintenance issue is active.');
    const item = this.get(repo, number);
    if (!item || item.status !== 'queued') throw new Error('Queue this issue before starting it.');
    Object.assign(item, { status: 'running', workerId: worker.id, baseline, commits: [] }); this.save();
  }
  reconcile(worker: WorkerInfo | undefined, commits: { sha: string; subject: string }[]) {
    let changed = false;
    for (const item of this.items) {
      if (item.issueState === 'CLOSED') continue;
      if (item.status !== 'running' && !(['review', 'paused'].includes(item.status) && worker?.id === item.workerId)) continue;
      const added = commits.filter(c => !item.baseline?.includes(c.sha));
      if (JSON.stringify(item.commits) !== JSON.stringify(added)) { item.commits = added; changed = true; }
      if (!worker || worker.id !== item.workerId || worker.status === 'exited') { item.status = 'paused'; changed = true; }
      else if (worker.status === 'done' && item.status !== 'review') { item.status = 'review'; changed = true; }
      else if (['starting', 'working', 'needs_input'].includes(worker.status) && ['review', 'paused'].includes(item.status)) { item.status = 'running'; changed = true; }
    }
    if (changed) this.save();
  }
  private save() { writeFileSync(this.file + '.tmp', JSON.stringify(this.items), { mode: 0o600 }); renameSync(this.file + '.tmp', this.file); }
}
