import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { LOBBY } from '../shared/lobby.js';
import { Court } from './court.js';
import { Garage } from './garage.js';
import { Jukebox } from './jukebox.js';
import { Whiteboard } from './whiteboard.js';
import type { Floor } from './floor.js';
import type { Ctx } from './office/context.js';
import type { Client } from './office/client.js';

/** Shared amenities, saved under the building's data directory, never a project checkout. */
export class Lobby {
  readonly id = LOBBY;
  readonly court = new Court();
  readonly garage = new Garage();
  readonly jukebox: Jukebox;
  readonly whiteboard: Whiteboard;

  constructor(dataDir: string) {
    const dir = path.join(dataDir, 'lobby');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.jukebox = new Jukebox(dir);
    this.whiteboard = new Whiteboard(dir);
  }
}

export type SocialFloor = Floor | Lobby;
export const socialFloor = (ctx: Ctx, c: Client): SocialFloor | undefined => c.peer.floor === LOBBY ? ctx.lobby : ctx.floorOf(c);
