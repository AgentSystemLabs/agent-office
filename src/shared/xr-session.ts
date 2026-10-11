import type { XrContext, XrRequirements } from './xr-playtests.js';
import type { Playtest } from './playtests.js';
export type Signal = string | number | boolean;
export interface XrRule extends XrRequirements {
  revision: number; role?: 'host' | 'guest'; twoDevices?: boolean;
  signal?: string; equals?: Signal;
}
export interface XrSnapshot {
  protocol: 1; appSession: string; sequence: number; context: XrContext;
  role: 'solo' | 'host' | 'guest'; signals: Record<string, Signal>;
  events: { id: number; message: string; kind: string }[];
  request?: 'pause' | 'resume' | 'stop' | 'bug';
}
export interface XrDevice { serial: string; name: string; status: string }
export interface XrCommand {
  id: string; device: string; kind: 'screenshot' | 'reserve-ammo'; at: number; build: string; appSession: string;
  status: 'pending' | 'done' | 'error'; result?: string; artifact?: boolean;
}
export interface XrObservation {
  id: string; testId: string; revision: number; device: string; build: string;
  appSession: string; at: number; context: XrContext; signals: Record<string, Signal>;
  events: XrSnapshot['events']; outcome: 'observed' | 'matched' | 'mismatch'; note: string;
}
export interface XrRun {
  id: string; owner: string; createdAt: number; endedAt?: number;
  status: 'pairing' | 'running' | 'paused' | 'stopped'; selected: string[];
  devices: XrDevice[]; heartbeat?: number; snapshots: Record<string, XrSnapshot>;
  pinnedBuilds: Record<string, string>; observations: XrObservation[];
  commands?: XrCommand[];
  observationCount?: number;
  markers?: { id: string; device: string; build: string; appSession: string; at: number; context: XrContext; signals: XrSnapshot['signals']; events: XrSnapshot['events'] }[];
}
export interface XrView {
  run?: XrRun; history: { id: string; createdAt: number; status: string }[];
  tests: Playtest[]; rules: Record<string, XrRule>;
  devices: { serial: string; active: string[]; reason?: string }[];
}
