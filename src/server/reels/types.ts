// The reels studio's records: the series a page posts, each reel from idea to posted, and the agents
// crewing it. Kept in <dataDir>/reels/reels.json by store.ts; see docs/reels.md for how they move.

export const PLATFORMS = ['tiktok', 'instagram', 'youtube'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** The agents a page is run by, each with its own brief (crew.ts). */
export const CREW_ROLES = ['scout', 'writer', 'editor', 'analyst'] as const;
export type CrewRole = (typeof CREW_ROLES)[number];

/**
 * Where a reel is: an `idea` (a scout's) is `scripted` by a writer, produced into a video
 * (`rendering`, then `rendered`), `approved` or `rejected` by an editor, and `posted` once every
 * platform its series posts to has it. `failed` is a production that broke, with `error` saying why.
 */
export type ReelStatus = 'idea' | 'scripted' | 'rendering' | 'rendered' | 'approved' | 'posting' | 'posted' | 'rejected' | 'failed';

/** A page's channel: one niche, one look, one voice, posted on a schedule. */
export interface Series {
  id: string;
  name: string;
  /** What it's about, as the scout and writer read it: "true crime from the 1800s, told as a mystery". */
  niche: string;
  /** The art style every image prompt ends with: "dark oil painting, dramatic lighting". */
  style: string;
  /** The narrator's voice: an OpenAI voice name, or an ElevenLabs voice id with ElevenLabs set up. */
  voice: string;
  /** How the narrator reads (OpenAI TTS instructions): "calm, low, suspenseful". */
  tone?: string;
  /** A track's file name in <dataDir>/reels/music, played under the voice. */
  music?: string;
  platforms: Platform[];
  /** How many reels go out a day, from 0.25 (every four days) to 6. */
  postsPerDay: number;
  /** Writers are asked for more once fewer than this many reels are waiting to go out. */
  backlog: number;
  /** Ends every caption: "Follow for part 2", a link-in-bio line. */
  cta?: string;
  hashtags: string[];
  /** What TikTok shows a post to: SELF_ONLY until the app is audited for public posting. */
  tiktokPrivacy: 'SELF_ONLY' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'PUBLIC_TO_EVERYONE';
  /** YouTube's privacy for a Short. */
  youtubePrivacy: 'private' | 'unlisted' | 'public';
  /** Nothing is posted or produced for it while paused. */
  paused: boolean;
  /** What the analyst learned from the numbers, newest last; writers read these. */
  notes: { at: number; by: string; text: string }[];
  createdBy: string;
  createdAt: number;
}

/** A beat of a reel: what the narrator says while one image is on screen. */
export interface Scene {
  narration: string;
  /** The image prompt, without the series' style (that's added). */
  visual: string;
}

export interface PostStats {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  at: number;
}

/** A reel on one platform. */
export interface Post {
  at: number;
  /** The platform's id for it: TikTok's publish id until its post id is known. */
  id?: string;
  url?: string;
  error?: string;
  stats?: PostStats;
}

export interface Reel {
  id: string;
  seriesId: string;
  status: ReelStatus;
  title: string;
  /** The first line, the one that stops the scroll. */
  hook?: string;
  /** What the scout had in mind, for the writer. */
  idea?: string;
  scenes?: Scene[];
  caption?: string;
  hashtags?: string[];
  addedBy: string;
  scriptedBy?: string;
  reviewedBy?: string;
  /** The editor's note: why it was rejected, or what to fix. */
  review?: string;
  /** The finished video, under <dataDir>/reels/out. */
  video?: string;
  /** Its length in seconds. */
  duration?: number;
  error?: string;
  posts: Partial<Record<Platform, Post>>;
  createdAt: number;
  updatedAt: number;
}

/** An agent on a page's crew, and where it sits. */
export interface CrewMember {
  role: CrewRole;
  workerId: string;
  floorId: string;
  name: string;
  /** The one series it works on; every series when there's none. */
  seriesId?: string;
  hiredAt: number;
  /** When the studio last asked it for something, so it isn't asked again and again. */
  nudgedAt?: number;
}

export interface ReelsState {
  series: Series[];
  reels: Reel[];
  crew: CrewMember[];
  /** When each series last posted. */
  lastPost: Record<string, number>;
  /** When the numbers were last fetched. */
  lastStats?: number;
}
