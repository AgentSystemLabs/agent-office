// The building's floors: riding the elevator between them and up to the roof, and adding and taking
// off floors.
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FloorClientMsg, RepoChoice } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { ROOF } from '../../../shared/rooftop.js';
import { arrivalSpot, str } from '../../office/input.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const projectView: ViewPieces['project'] = (_ctx, floor) => floor?.project ?? null;

export const floorHandlers = {
  'floor.go'(ctx, c, msg) {
    if (msg.floor === ROOF) {
      if (ctx.floors.size) ctx.goToRoof(c);
      else ctx.warn(c, 'There is no building to go up on yet');
      return;
    }
    const floor = ctx.floors.get(str(msg.floor, 64));
    if (!floor) ctx.warn(c, ctx.building.pending().some((d) => d.id === msg.floor) ? "That floor is still being cloned — it'll be ready in a moment" : 'No such floor');
    else ctx.goToFloor(c, floor, arrivalSpot(msg.at));
  },
  'floor.repos'(ctx, c, msg) {
    const floorProvider = ctx.plugins?.getFloorProvider();
    if (floorProvider) {
      void (async () => {
        try {
          const defs = await floorProvider.listFloors();
          const onBuilding = new Set(ctx.building.list().map((d) => d.id));
          const choices: RepoChoice[] = (defs || [])
            .filter((d) => !onBuilding.has(d.id))
            .map((d) => ({
              name: d.dir || d.name,
              description: d.name,
              private: false,
            }));
          ctx.sendTo(c, { t: 'floor.repos', repos: choices });
        } catch (err) {
          ctx.sendTo(c, { t: 'floor.repos', repos: [], error: (err as Error).message });
        }
      })();
      return;
    }
    void ctx.building.repos(msg.refresh === true).then(
      (repos) => ctx.sendTo(c, { t: 'floor.repos', repos }),
      (err: Error) => ctx.sendTo(c, { t: 'floor.repos', repos: [], error: `Couldn't list your repositories with gh: ${err.message}` }),
    );
  },
  'floor.add'(ctx, c, msg) {
    const who = c.peer.name;
    const repo = str(msg.repo, 400);
    const floorProvider = ctx.plugins?.getFloorProvider();
    if (floorProvider) {
      void (async () => {
        try {
          const res = await ctx.plugins?.createFloor({ repo, dir: repo });
          if (!res) return ctx.sendTo(c, { t: 'floor.added', repo, error: 'Could not create project via plugin' });
          ctx.building.unremove(res.dir || res.name);
          ctx.building.unremove(repo);
          const defs = await floorProvider.listFloors();
          ctx.building.mergeList(defs);
          for (const d of defs) ctx.openFloor(d);
          ctx.floorsChanged();
          const floor = ctx.floors.get(res.name) || [...ctx.floors.values()].find((f) => f.def.name === res.name);
          console.log(`  ${who} added ${res.name} as a floor`);
          ctx.toastAll(`🛗 New floor: ${res.name}, added by ${who}`);
          ctx.sendTo(c, { t: 'floor.added', repo, floor: floor?.id });
        } catch (err) {
          ctx.sendTo(c, { t: 'floor.added', repo, error: (err as Error).message });
        }
      })();
      return;
    }
    const isDir = repo.startsWith('/') || repo.startsWith('~') || existsSync(path.resolve(repo));
    if (isDir) {
      const dirPath = path.resolve(repo.startsWith('~') ? path.join(os.homedir(), repo.slice(1)) : repo);
      if (existsSync(dirPath)) {
        const name = path.basename(dirPath);
        const res = ctx.building.addExisting(dirPath, name, who);
        ctx.floorsChanged();
        if (typeof res === 'string') return ctx.sendTo(c, { t: 'floor.added', repo, error: res });
        const floor = ctx.openFloor(res);
        if (!floor) return ctx.sendTo(c, { t: 'floor.added', repo, error: `Added ${name}, but couldn't open its floor` });
        console.log(`  ${who} added a floor for ${name} (${dirPath})`);
        ctx.toastAll(`🛗 New floor: ${name}, added by ${who}`);
        return ctx.sendTo(c, { t: 'floor.added', repo, floor: floor.id });
      }
    }
    void ctx.building
      .add(
        repo,
        who,
        (def) => {
          ctx.floorsChanged();
          ctx.toastAll(`🛗 ${who} is adding a floor for ${def.repo ?? def.name}…`);
        },
        c.accountId,
      )
      .then((r) => {
        ctx.floorsChanged();
        if (typeof r === 'string') return ctx.sendTo(c, { t: 'floor.added', repo, error: r });
        const floor = ctx.openFloor(r);
        if (!floor) return ctx.sendTo(c, { t: 'floor.added', repo, error: `Cloned ${r.repo}, but couldn't open its floor — see the office's log` });
        console.log(`  ${who} added a floor for ${r.repo} (${r.dir})`);
        ctx.toastAll(`🛗 New floor: ${r.name}, added by ${who}`);
        ctx.sendTo(c, { t: 'floor.added', repo, floor: floor.id });
      });
  },
  'floor.cancel'(ctx, c, msg) {
    const who = c.peer.name;
    const admin = ctx.meOf(c.accountId).admin;
    const id = str(msg.floor, 64);
    const def = ctx.building.pending().find((d) => d.id === id);
    const err = ctx.building.cancel(id, `${who} stopped the clone`, (owner) => admin || (!!owner && owner === c.accountId));
    if (err) ctx.warn(c, err);
    else ctx.toastAll(`🛗 ${who} stopped cloning ${def?.repo ?? def?.name ?? 'a floor'}`);
  },
  'floor.remove'(ctx, c, msg) {
    const who = c.peer.name;
    // Everyone's workers on it stop: admins do it.
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can take a floor off the building');
    const id = str(msg.floor, 64);
    const r = ctx.building.remove(id, who);
    if (typeof r === 'string') return ctx.warn(c, r);
    console.log(`  ${who} took the ${r.name} floor off the building (${r.dir} stays where it is)`);
    const floor = ctx.floors.get(id);
    if (floor) ctx.closeFloor(floor, who);
    else ctx.floorsChanged();
  },
  'floor.projectsDir'(ctx, c, msg) {
    const who = c.peer.name;
    // It's a folder on the office's machine that `gh` writes into: admins pick it.
    const err = ctx.meOf(c.accountId).admin ? ctx.building.setProjectsDir(str(msg.dir, 1024), who) : 'Only admins can move the workspace folder';
    ctx.warn(c, err);
    if (err) return;
    const state = ctx.building.projectsDirState();
    ctx.broadcast({ t: 'projectsDir', state });
    ctx.toastAll(state.custom ? `📁 ${who} moved the workspace folder to ${state.dir}` : `📁 ${who} put the workspace folder back to ${state.dir}`);
  },
  'floor.maxFloors'(ctx, c, msg) {
    const who = c.peer.name;
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change the max floors limit');
    const n = Math.max(1, Math.min(2000, Math.floor(Number(msg.max) || 500)));
    ctx.building.setMaxFloors(n, who);
    const state = ctx.building.projectsDirState();
    ctx.broadcast({ t: 'projectsDir', state });
    ctx.toastAll(`🏢 ${who} set the max floors limit to ${n}`);
  },
} satisfies HandlerMap<FloorClientMsg>;
