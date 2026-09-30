// ⚙️ Settings and the building's services: notifications, the machine, upgrades, the sky, holidays, maps, prompts.

import type { CustomMap } from '../maps/index.js';
import type { PromptId } from '../prompts.js';
import type { AgentChoice } from './agents.js';

/**
 * The prompts the office writes for workers by itself (shared/prompts.ts) and the worker everyone
 * starts on, as set in ⚙️ Settings: the same on every floor.
 */
export interface PromptsState {
  /** Prompts someone rewrote, by id; the rest are the defaults. */
  custom: Partial<Record<PromptId, { text: string; by: string; at: number }>>;
  /**
   * What a worker starts on unless whoever starts it picks another. Unset: the agent the office was
   * started with (--agent), on its own default model.
   */
  agent?: AgentChoice & { by: string; at: number };
}

/** Where a team webhook posts: Slack and Discord get their own message format, anything else plain JSON. */
export type WebhookKind = 'slack' | 'discord' | 'other';

/** The office's Slack / Discord webhook, pinged when a worker needs input or finishes (see server/webhook.ts). */
export interface NotifyState {
  /** Never the URL itself (it lets anyone post to the channel): just where it goes. */
  webhook?: { kind: WebhookKind; hint: string; by: string; at: number };
  /** Why the last post failed, until one gets through. */
  error?: string;
  lastSentAt?: number;
}

/**
 * The office's machine (see server/machine.ts): how busy it is, for the wall monitor and a warning
 * before hiring, and the most workers the office runs at once, across every floor.
 */
export interface MachineState {
  /** Percent of every core busy, 0-100, over the last few seconds. */
  cpu: number;
  cores: number;
  /** Memory in use and in all, bytes. */
  memUsed: number;
  memTotal: number;
  /** The last few minutes, oldest first: [cpu %, memory %] a few seconds apart. */
  history: [number, number][];
  /** What makes another worker a strain right now, e.g. "memory is 93% used"; missing when nothing does. */
  pressure?: string;
  /** Workers in the office now: every floor's, shells and board agents too. */
  workers: number;
  /** The most workers the office takes; missing when there's no limit. */
  limit?: number;
  /** --max-workers: the limit can't be set any higher from the office. */
  ceiling?: number;
  /** The limit someone set in ⚙️ Settings, when there is one. */
  set?: { limit: number; by: string; at: number };
}

/** A web server a worker started (a dev server, a preview), found by the ports it listens on. */
export interface ServiceInfo {
  port: number;
  /** The address the office reaches it on, on its own machine. */
  host: string;
  pid: number;
  /** Its command line, shortened, e.g. "vite --port 5173". */
  command: string;
  /** The worker whose terminal started it. */
  workerId: string;
  /** Its working directory relative to its floor's checkout ('' is the project root). */
  cwd?: string;
  /** The <title> of its front page. */
  title?: string;
  since: number;
}

export interface ServicesState {
  items: ServiceInfo[];
  /** The office's port on its machine. Service tunnels end there and the office relays them. */
  port: number;
  /** How to run the script that deployed the office, as in TeamState. */
  deploy?: string;
  /** Where teammates tunnel to (offices deployed with deploy/aws.sh, deploy/railway.sh, deploy/fly.sh or deploy/dokploy.sh), as in TeamState */
  ssh?: string;
  /** The office's name on its Tailscale network: each server is also on https://<it>:<port> there. */
  tailnet?: string;
}

export interface VersionInfo {
  sha: string;
  subject: string;
  /** ISO commit date */
  date: string;
}

/** Self-upgrade of an office installed from git by deploy/aws.sh (see server/upgrade.ts). */
export interface UpgradeState {
  /** False when the office can't upgrade itself (not installed by deploy/aws.sh). */
  available: boolean;
  current?: VersionInfo;
  /** Newest commit upstream, when it differs from current. */
  latest?: VersionInfo;
  /** New commits since current, newest first (at most 15). */
  changes?: { sha: string; subject: string }[];
  /** How many new commits there are in all ("50" means 50 or more). */
  behind?: number;
  checking?: boolean;
  checkedAt?: number;
  phase: 'idle' | 'building' | 'restarting' | 'failed';
  /** Who started the upgrade. */
  by?: string;
  error?: string;
}

export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog';
export const WEATHERS: readonly Weather[] = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'];

/** What it's like outside the windows. The server decides it, so everyone sees the same sky. */
export interface SkyState {
  /** Where the office is, for the sun: a configured city, or a guess from the host's time zone. */
  lat: number;
  lon: number;
  /** The office's clock, in minutes east of UTC. */
  utcOffset: number;
  weather: Weather;
  /** 0–1: a drizzle to a downpour, a few flakes to a blizzard, haze to pea soup. */
  intensity: number;
  /** The city whose live forecast this is. Unset when the weather is made up or pinned. */
  city?: string;
  /** °C, from the forecast. */
  temp?: number;
}

/** A holiday the whole building dresses up for (see shared/theme.ts). */
export type Theme = 'halloween' | 'christmas';
/** What someone picked in ⚙️ Settings: a holiday, none, or whichever the calendar says. */
export type ThemePick = Theme | 'auto' | 'off';

/** The building's holiday theme: the same on every floor, for everyone. */
export interface ThemeState {
  pick: ThemePick;
  /** What's up right now: the pick, or for 'auto' the holiday it is at the office. Null for none. */
  active: Theme | null;
  /** Who picked it, and when. Unset for the default (auto). */
  by?: string;
  at?: number;
}

/**
 * The building's map: what every floor looks like inside (the office, the castle, or one of your
 * own), the same for everyone (see shared/maps). Custom maps come from the office's
 * .agent-office/maps/ folder, each with its whole config, or why it won't load.
 */
export interface MapState {
  pick: string;
  custom: CustomMap[];
  /** Who picked it, and when. Unset for the default (the office). */
  by?: string;
  at?: number;
}

/**
 * Whether a worker whose pull request merged goes home by itself (⚙️ Settings), for every floor:
 * once it's at rest and nobody has its terminal open, it leaves and its worktree and branch are deleted.
 */
export interface LeaveOnMergeState {
  on: boolean;
  /** Who set it, and when. Unset for the default (off). */
  by?: string;
  at?: number;
}

export type SettingsClientMsg =
  /** Set the office's Slack / Discord webhook; '' removes it. */
  | { t: 'notify.webhook'; url: string }
  /** Post a test message through the webhook; the outcome comes back as a toast. */
  | { t: 'notify.test' }
  /** Admins: the most workers the office runs at once, across every floor; null takes the limit off. */
  | { t: 'machine.limit'; limit: number | null }
  | { t: 'upgrade.check' }
  | { t: 'upgrade.start' }
  /** Dress the building up for a holiday, take the decorations down ('off'), or follow the calendar ('auto'). */
  | { t: 'theme.set'; pick: ThemePick }
  /** Change the building's map (see MapState), or with no map, read the custom maps' folder again. */
  | { t: 'map.set'; map?: string }
  /** Workers whose pull request merged go home by themselves (true), or wait to be sent home. */
  | { t: 'leaveOnMerge.set'; on: boolean }
  /** Rewrite one of the office's prompts (admins only); null puts the default back. */
  | { t: 'prompts.set'; id: PromptId; text: string | null }
  /** Pick the worker everyone starts on (admins only); null goes back to the office's --agent. */
  | { t: 'prompts.agent'; choice: AgentChoice | null };

export type SettingsServerMsg =
  | { t: 'upgrade'; state: UpgradeState }
  | { t: 'services'; state: ServicesState }
  | { t: 'notify'; state: NotifyState }
  | { t: 'machine'; state: MachineState }
  | { t: 'sky'; state: SkyState }
  | { t: 'theme'; state: ThemeState }
  | { t: 'map'; state: MapState }
  | { t: 'prompts'; state: PromptsState }
  | { t: 'leaveOnMerge'; state: LeaveOnMergeState };
