import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** A pairing code lives this long on the laptop's screen before the headset must ask for a new one. */
export const PAIR_CODE_TTL_MS = 10 * 60_000;
/** The code is short enough to read across the room: 8 Crockford base32 chars, no lookalikes. */
export const PAIR_CODE_LEN = 8;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A device token is 32 random bytes, shown once; only its hash is ever kept. */
export const DEVICE_TOKEN_BYTES = 32;

export interface DeviceRecord {
  id: string;
  /** What the headset called itself when it claimed its code ("Quest 3"). */
  name: string;
  /** SHA-256 of the token, hex. The token itself is never stored. */
  tokenHash: string;
  createdAt: number;
  lastSeenAt?: number;
}

/** A device record as the laptop's manage-devices list shows it: never the hash. */
export interface DeviceInfo {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt?: number;
}

interface Saved {
  devices: DeviceRecord[];
}

interface PendingCode {
  /** Hash of the code — the code itself is returned once and never kept, so a memory dump doesn't hand out pairing codes. */
  digest: Buffer;
  expiresAt: number;
}

const digestOf = (s: string) => createHash('sha256').update(s).digest();

/**
 * The headsets paired with this office, in .agent-office/devices.json next to the accounts: the
 * laptop shows a short code (as a QR), the headset claims it once for a long-lived token, and from
 * then on the token signs it in as that device. Codes live in memory only, so a restart invalidates
 * every unclaimed one; tokens survive restarts.
 */
export class Devices {
  private data: Saved = { devices: [] };
  private file: string;
  private pending: PendingCode[] = [];
  /** The file is there but couldn't be read: never write over it, or every device is unpaired. */
  private unreadable = false;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'devices.json');
    let raw: string;
    try {
      raw = readFileSync(this.file, 'utf8');
    } catch {
      return; // no devices yet
    }
    try {
      const saved = JSON.parse(raw) as Partial<Saved>;
      this.data = {
        devices: Array.isArray(saved.devices)
          ? saved.devices.filter((d) => d && typeof d.id === 'string' && typeof d.tokenHash === 'string' && typeof d.name === 'string')
          : [],
      };
    } catch (err) {
      this.unreadable = true;
      console.error(`agent-office: couldn't read ${this.file}: ${(err as Error).message}`);
    }
  }

  /** A fresh pairing code for the laptop to show; at most one is ever open. */
  start(): { code: string; expiresAt: number } {
    let code = '';
    for (let i = 0; i < PAIR_CODE_LEN; i++) code += CROCKFORD[randomBytes(1)[0] % CROCKFORD.length];
    const expiresAt = Date.now() + PAIR_CODE_TTL_MS;
    // One code at a time: starting a new one voids the old, so a screenshot of it stops working.
    this.pending = [{ digest: digestOf(code), expiresAt }];
    return { code, expiresAt };
  }

  /**
   * Trades a pairing code for a device token. Single-use: claiming consumes the code. Returns the
   * token (shown once) and the record, or undefined when the code is wrong, used or expired — with
   * no word on which, so codes can't be enumerated.
   */
  claim(code: string, name: string): { token: string; device: DeviceInfo } | undefined {
    this.dropExpired();
    const want = digestOf(String(code).trim().toUpperCase());
    const i = this.pending.findIndex((p) => p.digest.length === want.length && timingSafeEqual(p.digest, want));
    if (i < 0) return undefined;
    this.pending.splice(i, 1);
    const token = randomBytes(DEVICE_TOKEN_BYTES).toString('base64url');
    const record: DeviceRecord = {
      id: randomBytes(8).toString('hex'),
      name: name.trim().slice(0, 64) || 'Headset',
      tokenHash: digestOf(token).toString('hex'),
      createdAt: Date.now(),
    };
    this.data.devices.push(record);
    this.save();
    const { tokenHash: _h, ...device } = record;
    return { token, device };
  }

  list(): DeviceInfo[] {
    return this.data.devices.map(({ tokenHash: _h, ...d }) => ({ ...d }));
  }

  /** Whether the device is still paired (its token wasn't revoked). */
  has(id: string | undefined): boolean {
    return !!id && this.data.devices.some((d) => d.id === id);
  }

  /** Deletes a device. Its token stops working on its next request. */
  revoke(id: string): DeviceRecord | undefined {
    const i = this.data.devices.findIndex((d) => d.id === id);
    if (i < 0) return undefined;
    const [d] = this.data.devices.splice(i, 1);
    this.save();
    return d;
  }

  /** The device a bearer token signs in, if any; notes that it was seen. */
  verify(token: string | undefined): DeviceRecord | undefined {
    if (!token) return undefined;
    const want = digestOf(token);
    const d = this.data.devices.find((v) => {
      const h = Buffer.from(v.tokenHash, 'hex');
      return h.length === want.length && timingSafeEqual(h, want);
    });
    if (!d) return undefined;
    this.seen(d);
    return d;
  }

  private seen(d: DeviceRecord) {
    const now = Date.now();
    // Tokens authenticate every request; the disk only needs to know about once a minute.
    if (d.lastSeenAt && now - d.lastSeenAt < 60_000) return;
    d.lastSeenAt = now;
    this.save();
  }

  private dropExpired() {
    const now = Date.now();
    this.pending = this.pending.filter((p) => p.expiresAt > now);
  }

  private save() {
    if (this.unreadable) {
      console.error(`agent-office: not saving devices over ${this.file}, which couldn't be read — fix or move it`);
      return;
    }
    // Written whole and renamed into place, so a crash never leaves half a file.
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      console.error(`agent-office: couldn't save ${this.file}: ${(err as Error).message}`);
      return;
    }
    try {
      statSync(this.file);
    } catch {
      // saved anyway
    }
  }
}

/** A bearer token from an Authorization header, or undefined when there isn't one. */
export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m?.[1];
}
