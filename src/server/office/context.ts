// What every part of the office shares: the building-wide singletons and the helpers the WebSocket
// handlers, the HTTP routes and the hook server use. startServer (server.ts) makes it a stage at a
// time, in the order the office has always started up in (see each stage's interface), so a part
// only ever uses what was already there when it was made.
import type { Config } from '../config.js';
import type { Auth } from '../auth.js';
import type { Accounts } from '../accounts.js';
import type { SignIns, GhAs } from '../signins.js';
import type { GrokModelCatalogue, OpenCodeModelCatalogue } from '../models.js';
import type { Tailnet } from '../tailnet.js';
import type { Team } from '../team.js';
import type { Upgrader } from '../upgrade.js';
import type { Services } from '../services.js';
import type { ImageProxy } from '../decor.js';
import type { Ledger } from '../usage.js';
import type { PlanLimitsReader } from '../limits.js';
import type { Webhook } from '../webhook.js';
import type { Machine } from '../machine.js';
import type { Building, FloorDef } from '../building.js';
import type { Floor } from '../floor.js';
import type { Sky } from '../sky.js';
import type { Themes } from '../theme.js';
import type { Maps } from '../maps.js';
import type { OfficePrompts } from '../prompts.js';
import type { LeaveOnMerge } from '../leave-on-merge.js';
import type { ChatLog } from '../history.js';
import type { Arcade, HighScores } from '../cabinet.js';
import type { FloorInfo, Me, ServerMsg, ServiceInfo, ServicesState, SignInKind } from '../../shared/protocol.js';
import type { Client } from './client.js';
import type { Spot } from './input.js';

export type ToastLevel = Extract<ServerMsg, { t: 'toast' }>['level'];

/** Made first (office/core.ts). */
export interface Core {
  cfg: Config;
  /** The client bundle the office serves. */
  publicDir: string;
  accounts: Accounts;
  auth: Auth;
  /** Everyone in the office, by connection. */
  clients: Map<string, Client>;
  /** Kept on disk, so a restart doesn't wipe it. */
  chat: ChatLog;
  /** The arcade's high scores: one table for the whole building, on every floor's cabinet. */
  highScores: HighScores;
  arcade: Arcade;
  /** What the office is called where it has no project of its own to go by (webhooks, invites). */
  officeName: string;
  openCodeModels: OpenCodeModelCatalogue;
  grokModels: GrokModelCatalogue;
  /** The building: a floor per project, each with its own workers, boards and queue. */
  building: Building;
  floors: Map<string, Floor>;
}

/** Made once the hook server listens, before any floor opens (office/services.ts). */
export interface BuildingServices {
  sky: Sky;
  themes: Themes;
  maps: Maps;
  prompts: OfficePrompts;
  leaveOnMerge: LeaveOnMerge;
  ledger: Ledger;
  signins: SignIns;
  /** The office's own Claude plan limits. */
  limits: PlanLimitsReader;
  /** Each account's own, once it runs on a Claude sign-in of its own. */
  accountLimits: Map<string, { key: string; reader: PlanLimitsReader }>;
  webhook: Webhook;
  machine: Machine;
  /** Whose plan `c` sees: their own, on an account with its own Claude sign-in; else the office's. */
  limitsOf(c: Client): PlanLimitsReader;
  /** Queues everywhere may be waiting for room under the worker limit: let them look again. */
  pumpQueues(except?: Floor): void;
}

/** Made as the floors open (office/floors.ts). */
export interface FloorsOpen {
  /** Opens a floor of the building; undefined (and a note in the log) when it can't. */
  openFloor(def: FloorDef): Floor | undefined;
}

/** Made once the floors are open (office/services.ts). */
export interface LateServices {
  team: Team;
  tailnet: Tailnet;
  services: Services;
  images: ImageProxy;
  upgrader: Upgrader;
  /** A floor's Services board: its own workers' servers. */
  servicesState(floor: Floor | undefined, items?: ServiceInfo[]): ServicesState;
}

/** Sending to browsers (office/messaging.ts). */
export interface Messaging {
  sendTo(c: Client, msg: ServerMsg): void;
  broadcast(msg: ServerMsg, except?: string, droppable?: boolean): void;
  toastAll(text: string, level?: ToastLevel): void;
  /** To everyone on one floor. */
  toFloor(floor: Floor, msg: ServerMsg, droppable?: boolean): void;
  toastFloor(floor: Floor | undefined, text: string, level?: ToastLevel): void;
  /** To everyone else on the same floor as `c`: nobody on another floor can see them. */
  toNeighbors(c: Client, msg: ServerMsg, droppable?: boolean): void;
  /** Tells just this person why their request didn't happen; nothing when there's no error. */
  warn(c: Client, error: string | undefined): void;
}

/** The building's floors (office/floors.ts). */
export interface FloorHelpers {
  floorOf(c: Client): Floor | undefined;
  /** The floor a worker sits on. Worker ids are unique across the building. */
  workerFloor(workerId: string): Floor | undefined;
  floorInfos(): FloorInfo[];
  /** The elevator's counts change with every worker update; tell everyone at most a few times a second. */
  floorsChanged(): void;
  /** Drops a `floorsChanged` still waiting to go out (the office is closing). */
  cancelFloorsChanged(): void;
  /** Where someone arriving goes: the floor they asked for, else the first one there is. */
  arrivalFloor(wanted: string | null): Floor | undefined;
  /**
   * Takes `floor` off the building (already out of floors.json): everyone on it rides the elevator to
   * the next floor, or out to the lobby if it was the last (the roof goes with it), and its workers stop.
   */
  closeFloor(floor: Floor, who: string): void;
}

/** Who's signed in (office/people.ts). */
export interface People {
  /** Who a connection is: its account's current name and role, or an admin guest on the shared password. */
  meOf(accountId: string | undefined): Me;
  /** Still signed in: the account wasn't revoked, and the shared password wasn't switched off. */
  stillIn(c: Client): boolean;
  signOut(c: Client): void;
  onlineAccounts(): Set<string>;
  /** Tells each admin what the accounts are now, and everyone whether they're (still) an admin. */
  accountsChanged(): void;
}

/** Going between floors (office/navigation.ts). */
export interface Navigation {
  /**
   * Takes `c` to another floor: everyone sees them leave and arrive, and they get the new floor's
   * everything. They arrive in the elevator, or `at` the spot they came by.
   */
  goToFloor(c: Client, floor: Floor, at?: Spot): void;
  /** Up to the rooftop bar, by elevator. */
  goToRoof(c: Client): void;
  /** Out to the lobby, where the elevator has nowhere to go: the building's last floor was taken off. */
  toLobby(c: Client): void;
}

/** What has to be true before something happens for someone (office/gates.ts). */
export interface Gates {
  /**
   * A worker took on GitHub issue `n` (an issue card dropped on its desk): assign it on GitHub, which
   * moves it to In progress on the board, and take it off the queue so nobody else is seated for it.
   */
  takeIssue(c: Client, floor: Floor, n: number): void;
  /**
   * Runs `go` once `c` has a sign-in of their own to `which` (only accounts need one: on the shared
   * password it's the office's own). Without one it looks again, since they may have just signed
   * in from a shell, and otherwise tells them why (`refused`, else a toast) and opens their sign-ins.
   */
  withSignIn(c: Client, which: SignInKind | undefined, go: () => void, refused?: (why: string) => void): void;
  /**
   * Runs `go` once a worktree made on `floor` would start from what's on GitHub now (see
   * Worktrees.fetch): right away when that was just fetched, else after a fetch, if `c` and the floor
   * are still there.
   */
  withFreshBase(c: Client, floor: Floor | Floor[], go: () => void): void;
  /** Runs `go` with how the office acts on GitHub for `c`: as them, or as itself (no account, or an admin's choice). */
  withGitHub(c: Client, go: (as: GhAs | undefined) => void, refused?: (why: string) => void): void;
  /** Needs a Claude sign-in of its own when the worker it starts runs Claude. */
  claudeFor(provider: string | undefined): SignInKind | undefined;
}

export type Ctx = Core & BuildingServices & FloorsOpen & LateServices & Messaging & FloorHelpers & People & Navigation & Gates;
