// The page's sign-ins to TikTok, Instagram and YouTube: what the office posts with. A person puts
// them in <dataDir>/reels/accounts.json (see docs/reels.md for how to get each); the office keeps
// refreshed tokens there too. No agent ever reads them: the studio only says which are connected.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Platform } from './types.js';

export interface TikTokAccount {
  clientKey: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken: string;
  /** When the access token runs out (ms since 1970). */
  expiresAt?: number;
}

export interface InstagramAccount {
  /** The Instagram professional account's id (the IG user id, not the Facebook page's). */
  userId: string;
  /** A long-lived token with instagram_content_publish (and instagram_manage_insights for numbers). */
  accessToken: string;
  /** graph.facebook.com for a token from Facebook Login; graph.instagram.com for Instagram Login. */
  host?: string;
}

export interface YouTubeAccount {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
}

export interface Accounts {
  tiktok?: TikTokAccount;
  instagram?: InstagramAccount;
  youtube?: YouTubeAccount;
}

const has = (o: Record<string, unknown> | undefined, keys: string[]) => !!o && keys.every((k) => typeof o[k] === 'string' && o[k]);

/** Which platforms have a usable sign-in. */
export function connected(a: Accounts): Platform[] {
  const out: Platform[] = [];
  if (has(a.tiktok as never, ['clientKey', 'clientSecret', 'refreshToken'])) out.push('tiktok');
  if (has(a.instagram as never, ['userId', 'accessToken'])) out.push('instagram');
  if (has(a.youtube as never, ['clientId', 'clientSecret', 'refreshToken'])) out.push('youtube');
  return out;
}

export class AccountsFile {
  private file: string;

  constructor(dir: string) {
    this.file = path.join(dir, 'accounts.json');
  }

  /** Read fresh each time, so a person can add one without restarting the office. */
  read(): Accounts {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Accounts;
    } catch {
      return {};
    }
  }

  /** Keeps a platform's refreshed tokens. */
  update<P extends keyof Accounts>(platform: P, patch: Partial<NonNullable<Accounts[P]>>) {
    const all = this.read();
    all[platform] = { ...(all[platform] as object), ...patch } as Accounts[P];
    writeFileSync(this.file, JSON.stringify(all, null, 2), { mode: 0o600 });
  }
}
