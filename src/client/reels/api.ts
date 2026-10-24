// What the reels studio's page asks the office for (http/routes/reels.ts on the server), and the
// shapes it gets back.

export type Platform = 'tiktok' | 'instagram' | 'youtube';
export type ReelStatus = 'idea' | 'scripted' | 'rendering' | 'rendered' | 'approved' | 'posting' | 'posted' | 'rejected' | 'failed';
export const PLATFORMS: Platform[] = ['tiktok', 'instagram', 'youtube'];
export const ROLES = ['scout', 'writer', 'editor', 'analyst'] as const;

export interface Series {
  id: string;
  name: string;
  niche: string;
  style: string;
  voice: string;
  tone?: string;
  music?: string;
  platforms: Platform[];
  postsPerDay: number;
  backlog: number;
  cta?: string;
  hashtags: string[];
  tiktokPrivacy: string;
  youtubePrivacy: string;
  paused: boolean;
  notes: { at: number; by: string; text: string }[];
  pipeline: { ideas: number; inPipe: number; toReview: number; approved: number; posted: number; failed: number };
  lastPost?: number;
  nextPostAfter?: number;
}

export interface ReelRow {
  id: string;
  series: string;
  status: ReelStatus;
  title: string;
  hook?: string;
  by: string;
  review?: string;
  error?: string;
  seconds?: number;
  posts?: { platform: Platform; url?: string; error?: string; views?: number }[];
}

export interface PostStats {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  at: number;
}

export interface Reel {
  id: string;
  seriesId: string;
  status: ReelStatus;
  title: string;
  hook?: string;
  idea?: string;
  scenes?: { narration: string; visual: string }[];
  caption?: string;
  hashtags?: string[];
  addedBy: string;
  scriptedBy?: string;
  reviewedBy?: string;
  review?: string;
  duration?: number;
  error?: string;
  videoExists?: boolean;
  postCaption?: string;
  posts: Partial<Record<Platform, { at: number; id?: string; url?: string; error?: string; stats?: PostStats }>>;
  createdAt: number;
  updatedAt: number;
}

export interface CrewRow {
  role: (typeof ROLES)[number];
  name: string;
  workerId: string;
  seriesId?: string;
  status: string;
}

export interface Overview {
  me: { name: string; admin: boolean };
  floors: { id: string; name: string }[];
  series: Series[];
  reels: ReelRow[];
  crew: CrewRow[];
  media: { voice: string; images: string };
  connected: Platform[];
  lastStats?: number;
}

async function ask<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/reels${path}`, { credentials: 'same-origin', ...init });
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('Signed out');
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `The office said no (${res.status})`);
  return body;
}

export const api = {
  overview: () => ask<Overview>(''),
  reel: (id: string) => ask<Reel>(`/reel?id=${encodeURIComponent(id)}`),
  videoUrl: (id: string, at?: number) => `/api/reels/video/${encodeURIComponent(id)}${at ? `?v=${at}` : ''}`,
  post: <T = unknown>(path: string, body: Record<string, unknown>) =>
    ask<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
};

/** "3h ago", "in 5h", "never". */
export function when(t: number | undefined, now = Date.now()): string {
  if (!t) return 'never';
  const m = Math.round((t - now) / 60000);
  const a = Math.abs(m);
  const s = a < 1 ? 'now' : a < 60 ? `${a}m` : a < 2880 ? `${Math.round(a / 60)}h` : `${Math.round(a / 1440)}d`;
  return s === 'now' ? 'just now' : m < 0 ? `${s} ago` : `in ${s}`;
}

/** A count, short: 1.2k, 3.4M. */
export function short(n: number | undefined): string {
  if (n === undefined) return '–';
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}

export const STATUS_LABEL: Record<ReelStatus, string> = {
  idea: '💡 Idea',
  scripted: '✍️ Scripted',
  rendering: '⚙️ Making',
  rendered: '👀 To review',
  approved: '✅ Approved',
  posting: '📲 Posting',
  posted: '🚀 Posted',
  rejected: '✏️ Sent back',
  failed: '⚠️ Failed',
};
