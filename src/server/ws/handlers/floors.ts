// The building's floors: riding the elevator between them and up to the roof, and adding and taking
// off floors.
import type { FloorClientMsg } from '../../../shared/protocol.js';
import { ROOF } from '../../../shared/rooftop.js';
import { arrivalSpot, str } from '../../office/input.js';
import type { HandlerMap, ViewPieces } from './types.js';
import { L } from '../../i18n.js';

export const projectView: ViewPieces['project'] = (_ctx, floor) => floor?.project ?? null;

export const floorHandlers = {
  'floor.go'(ctx, c, msg) {
    if (msg.floor === ROOF) {
      if (ctx.floors.size) ctx.goToRoof(c);
      else ctx.warn(c, L.srv.noBuilding);
      return;
    }
    const floor = ctx.floors.get(str(msg.floor, 64));
    if (!floor) ctx.warn(c, ctx.building.pending().some((d) => d.id === msg.floor) ? L.srv.stillCloning : L.srv.noSuchFloor);
    else ctx.goToFloor(c, floor, arrivalSpot(msg.at));
  },
  'floor.repos'(ctx, c, msg) {
    void ctx.building.repos(msg.refresh === true).then(
      (repos) => ctx.sendTo(c, { t: 'floor.repos', repos }),
      (err: Error) => ctx.sendTo(c, { t: 'floor.repos', repos: [], error: L.srv.listReposFailed(err.message) }),
    );
  },
  'floor.add'(ctx, c, msg) {
    const who = c.peer.name;
    const repo = str(msg.repo, 200);
    void ctx.building
      .add(
        repo,
        who,
        (def) => {
          ctx.floorsChanged();
          ctx.toastAll(L.srv.addingFloor(who, def.repo ?? def.name));
        },
        c.accountId,
      )
      .then((r) => {
        ctx.floorsChanged();
        if (typeof r === 'string') return ctx.sendTo(c, { t: 'floor.added', repo, error: r });
        const floor = ctx.openFloor(r);
        if (!floor) return ctx.sendTo(c, { t: 'floor.added', repo, error: L.srv.clonedNoFloor(r.repo ?? r.name) });
        console.log(`  ${L.srv.addedFloorLog(who, r.repo ?? r.name, r.dir)}`);
        ctx.toastAll(L.srv.newFloor(r.name, who));
        ctx.sendTo(c, { t: 'floor.added', repo, floor: floor.id });
      });
  },
  'floor.cancel'(ctx, c, msg) {
    const who = c.peer.name;
    const admin = ctx.meOf(c.accountId).admin;
    const id = str(msg.floor, 64);
    const def = ctx.building.pending().find((d) => d.id === id);
    const err = ctx.building.cancel(id, L.clone.stoppedBy(who), (owner) => admin || (!!owner && owner === c.accountId));
    if (err) ctx.warn(c, err);
    else ctx.toastAll(`🛗 ${L.clone.stoppedCloning(who, def?.repo ?? def?.name ?? L.clone.aFloor)}`);
  },
  'floor.remove'(ctx, c, msg) {
    const who = c.peer.name;
    // Everyone's workers on it stop: admins do it.
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, L.srv.adminsFloor);
    const id = str(msg.floor, 64);
    const r = ctx.building.remove(id, who);
    if (typeof r === 'string') return ctx.warn(c, r);
    console.log(`  ${L.srv.tookFloorLog(who, r.name, r.dir)}`);
    const floor = ctx.floors.get(id);
    if (floor) ctx.closeFloor(floor, who);
    else ctx.floorsChanged();
  },
  'floor.projectsDir'(ctx, c, msg) {
    const who = c.peer.name;
    // It's a folder on the office's machine that `gh` writes into: admins pick it.
    const err = ctx.meOf(c.accountId).admin ? ctx.building.setProjectsDir(str(msg.dir, 1024), who) : L.srv.adminsDir;
    ctx.warn(c, err);
    if (err) return;
    const state = ctx.building.projectsDirState();
    ctx.broadcast({ t: 'projectsDir', state });
    ctx.toastAll(state.custom ? L.srv.movedDir(who, state.dir) : L.srv.dirBack(who, state.dir));
  },
} satisfies HandlerMap<FloorClientMsg>;
