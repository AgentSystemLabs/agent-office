// Posting a finished reel, and reading back how it's doing: TikTok's Content Posting API, Instagram's
// Reels publishing (a resumable upload, so the video needn't be on a public URL) and a YouTube Short.
// Every post is marked as AI-made where the platform has a way to say so.

import { readFileSync, statSync } from 'node:fs';
import type { AccountsFile, Accounts } from './accounts.js';
import type { Platform, Post, PostStats } from './types.js';

export interface Upload {
  video: string;
  title: string;
  caption: string;
  tiktokPrivacy: string;
  youtubePrivacy: string;
}

type Fetch = typeof fetch;
const IG_VERSION = 'v21.0';
/** How long to wait for a platform to finish processing an upload. */
const PROCESS_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json<T>(what: string, res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  if (!res.ok) throw new Error(`${what} failed (${res.status}): ${JSON.stringify(body).slice(0, 400)}`);
  return body as T;
}

// --- TikTok --------------------------------------------------------------------------------------

async function tiktokToken(accounts: AccountsFile, f: Fetch): Promise<string> {
  const a = accounts.read().tiktok;
  if (!a) throw new Error('TikTok isn\'t connected');
  if (a.accessToken && (a.expiresAt ?? 0) > Date.now() + 60_000) return a.accessToken;
  const res = await f('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: a.clientKey, client_secret: a.clientSecret, grant_type: 'refresh_token', refresh_token: a.refreshToken }),
  });
  const t = await json<{ access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string }>('TikTok sign-in', res);
  if (!t.access_token) throw new Error(`TikTok sign-in failed: ${t.error_description ?? 'no token'}`);
  accounts.update('tiktok', { accessToken: t.access_token, refreshToken: t.refresh_token ?? a.refreshToken, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 });
  return t.access_token;
}

/**
 * Posts to TikTok: asks what privacy the creator allows (TikTok requires that), starts a direct
 * post with the video in one chunk, uploads it, and waits until TikTok says it's up.
 */
async function postTikTok(u: Upload, accounts: AccountsFile, f: Fetch): Promise<Post> {
  const token = await tiktokToken(accounts, f);
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' };
  const creator = await json<{ data?: { privacy_level_options?: string[] } }>(
    'TikTok creator info',
    await f('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', { method: 'POST', headers: auth }),
  );
  const options = creator.data?.privacy_level_options ?? [];
  // An app TikTok hasn't audited may only post privately: fall back to that rather than fail.
  const privacy = options.includes(u.tiktokPrivacy) ? u.tiktokPrivacy : options.includes('SELF_ONLY') ? 'SELF_ONLY' : options[0] ?? 'SELF_ONLY';
  const size = statSync(u.video).size;
  const init = await json<{ data?: { publish_id?: string; upload_url?: string } }>(
    'TikTok post',
    await f('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        post_info: { title: u.caption.slice(0, 2200), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false, is_aigc: true },
        source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 },
      }),
    }),
  );
  const id = init.data?.publish_id;
  const url = init.data?.upload_url;
  if (!id || !url) throw new Error('TikTok gave no upload address');
  const put = await f(url, { method: 'PUT', headers: { 'content-type': 'video/mp4', 'content-length': String(size), 'content-range': `bytes 0-${size - 1}/${size}` }, body: readFileSync(u.video) });
  if (!put.ok) throw new Error(`Uploading to TikTok failed (${put.status})`);
  const until = Date.now() + PROCESS_MS;
  while (Date.now() < until) {
    await sleep(5000);
    const s = await json<{ data?: { status?: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] } }>(
      'TikTok post status',
      await f('https://open.tiktokapis.com/v2/post/publish/status/fetch/', { method: 'POST', headers: auth, body: JSON.stringify({ publish_id: id }) }),
    );
    const status = s.data?.status;
    if (status === 'FAILED') throw new Error(`TikTok turned it down: ${s.data?.fail_reason ?? 'no reason given'}`);
    if (status === 'PUBLISH_COMPLETE') {
      const postId = s.data?.publicaly_available_post_id?.[0];
      return { at: Date.now(), id: postId ? String(postId) : id, ...(postId ? { url: `https://www.tiktok.com/video/${postId}` } : {}), ...(privacy !== u.tiktokPrivacy ? { error: `posted as ${privacy}: TikTok doesn't allow ${u.tiktokPrivacy} for this app yet` } : {}) };
    }
  }
  return { at: Date.now(), id, error: 'TikTok was still processing it' };
}

// --- Instagram -----------------------------------------------------------------------------------

/** Posts a Reel: makes a resumable container, uploads the bytes, waits for it to process, publishes. */
async function postInstagram(u: Upload, accounts: AccountsFile, f: Fetch): Promise<Post> {
  const a = accounts.read().instagram;
  if (!a) throw new Error('Instagram isn\'t connected');
  const host = a.host || 'graph.facebook.com';
  const api = (p: string) => `https://${host}/${IG_VERSION}/${p}`;
  const container = await json<{ id?: string; uri?: string }>(
    'Instagram container',
    await f(api(`${a.userId}/media`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${a.accessToken}` },
      body: JSON.stringify({ media_type: 'REELS', upload_type: 'resumable', caption: u.caption.slice(0, 2200), share_to_feed: true }),
    }),
  );
  if (!container.id) throw new Error('Instagram made no container');
  const bytes = readFileSync(u.video);
  const up = await f(container.uri ?? `https://rupload.facebook.com/ig-api-upload/${IG_VERSION}/${container.id}`, {
    method: 'POST',
    headers: { authorization: `OAuth ${a.accessToken}`, offset: '0', file_size: String(bytes.length) },
    body: bytes,
  });
  if (!up.ok) throw new Error(`Uploading to Instagram failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
  const until = Date.now() + PROCESS_MS;
  for (;;) {
    await sleep(5000);
    const s = await json<{ status_code?: string; status?: string }>('Instagram status', await f(api(`${container.id}?fields=status_code,status`), { headers: { authorization: `Bearer ${a.accessToken}` } }));
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram couldn't process it: ${s.status ?? s.status_code}`);
    if (Date.now() > until) throw new Error('Instagram was still processing it');
  }
  const done = await json<{ id?: string }>(
    'Instagram publish',
    await f(api(`${a.userId}/media_publish`), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${a.accessToken}` }, body: JSON.stringify({ creation_id: container.id }) }),
  );
  if (!done.id) throw new Error('Instagram published nothing');
  const link = await json<{ permalink?: string }>('Instagram permalink', await f(api(`${done.id}?fields=permalink`), { headers: { authorization: `Bearer ${a.accessToken}` } })).catch(() => ({ permalink: undefined }));
  return { at: Date.now(), id: done.id, ...(link.permalink ? { url: link.permalink } : {}) };
}

// --- YouTube -------------------------------------------------------------------------------------

async function youtubeToken(accounts: AccountsFile, f: Fetch): Promise<string> {
  const a = accounts.read().youtube;
  if (!a) throw new Error('YouTube isn\'t connected');
  if (a.accessToken && (a.expiresAt ?? 0) > Date.now() + 60_000) return a.accessToken;
  const t = await json<{ access_token?: string; expires_in?: number }>(
    'YouTube sign-in',
    await f('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: a.clientId, client_secret: a.clientSecret, refresh_token: a.refreshToken, grant_type: 'refresh_token' }),
    }),
  );
  if (!t.access_token) throw new Error('YouTube gave no token');
  accounts.update('youtube', { accessToken: t.access_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 });
  return t.access_token;
}

/** Uploads a Short: a vertical video under three minutes, with #Shorts in its title. */
async function postYouTube(u: Upload, accounts: AccountsFile, f: Fetch): Promise<Post> {
  const token = await youtubeToken(accounts, f);
  const bytes = readFileSync(u.video);
  const title = `${u.title.slice(0, 88)} #Shorts`;
  const start = await f('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'video/mp4', 'x-upload-content-length': String(bytes.length) },
    body: JSON.stringify({
      snippet: { title, description: u.caption.slice(0, 4900), categoryId: '24' },
      status: { privacyStatus: u.youtubePrivacy, selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
    }),
  });
  if (!start.ok) throw new Error(`YouTube upload failed to start (${start.status}): ${(await start.text()).slice(0, 300)}`);
  const at = start.headers.get('location');
  if (!at) throw new Error('YouTube gave no upload address');
  const video = await json<{ id?: string }>('YouTube upload', await f(at, { method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: bytes }));
  if (!video.id) throw new Error('YouTube made no video');
  return { at: Date.now(), id: video.id, url: `https://www.youtube.com/shorts/${video.id}` };
}

/** Posts the reel to `platform`. */
export function publish(platform: Platform, u: Upload, accounts: AccountsFile, f: Fetch = fetch): Promise<Post> {
  if (platform === 'tiktok') return postTikTok(u, accounts, f);
  if (platform === 'instagram') return postInstagram(u, accounts, f);
  return postYouTube(u, accounts, f);
}

// --- Numbers -------------------------------------------------------------------------------------

/** How each post is doing, by platform and post id; posts a platform wouldn't say about are left out. */
export async function fetchStats(posts: { platform: Platform; id: string }[], accounts: AccountsFile, f: Fetch = fetch): Promise<Map<string, PostStats>> {
  const out = new Map<string, PostStats>();
  const at = Date.now();
  const by = (p: Platform) => posts.filter((x) => x.platform === p).map((x) => x.id);
  const a: Accounts = accounts.read();
  const tt = by('tiktok').filter((id) => /^\d+$/.test(id));
  if (tt.length && a.tiktok) {
    const token = await tiktokToken(accounts, f);
    for (let i = 0; i < tt.length; i += 20) {
      const r = await json<{ data?: { videos?: { id: string; view_count?: number; like_count?: number; comment_count?: number; share_count?: number }[] } }>(
        'TikTok numbers',
        await f('https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ filters: { video_ids: tt.slice(i, i + 20) } }),
        }),
      );
      for (const v of r.data?.videos ?? []) out.set(`tiktok:${v.id}`, { views: v.view_count, likes: v.like_count, comments: v.comment_count, shares: v.share_count, at });
    }
  }
  if (a.instagram) {
    const host = a.instagram.host || 'graph.facebook.com';
    for (const id of by('instagram')) {
      const r = await json<{ data?: { name: string; values?: { value: number }[] }[] }>(
        'Instagram numbers',
        await f(`https://${host}/${IG_VERSION}/${id}/insights?metric=views,likes,comments,shares`, { headers: { authorization: `Bearer ${a.instagram.accessToken}` } }),
      ).catch(() => undefined);
      const v = (name: string) => r?.data?.find((m) => m.name === name)?.values?.[0]?.value;
      if (r) out.set(`instagram:${id}`, { views: v('views'), likes: v('likes'), comments: v('comments'), shares: v('shares'), at });
    }
  }
  const yt = by('youtube');
  if (yt.length && a.youtube) {
    const token = await youtubeToken(accounts, f);
    for (let i = 0; i < yt.length; i += 50) {
      const r = await json<{ items?: { id: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }>(
        'YouTube numbers',
        await f(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${yt.slice(i, i + 50).join(',')}`, { headers: { authorization: `Bearer ${token}` } }),
      );
      const n = (s?: string) => (s === undefined ? undefined : Number(s));
      for (const v of r.items ?? []) out.set(`youtube:${v.id}`, { views: n(v.statistics?.viewCount), likes: n(v.statistics?.likeCount), comments: n(v.statistics?.commentCount), at });
    }
  }
  return out;
}
