import { LOBBY } from '../../../shared/lobby.js';
// The building's floors: riding the elevator between them and up to the roof, and adding and taking
// off floors.
import type { FloorClientMsg } from '../../../shared/protocol.js';
import { ROOF } from '../../../shared/rooftop.js';
import { arrivalSpot, str } from '../../office/input.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const projectView: ViewPieces['project'] = (_ctx, floor) => floor?.project ?? null;

export const floorHandlers = {
  'floor.go'(ctx, c, msg) {
    if (msg.floor === LOBBY) return ctx.toLobby(c, arrivalSpot(msg.at));
    if (msg.floor === ROOF) {
      ctx.goToRoof(c);
      return;
    }
    const floor = ctx.floors.get(str(msg.floor, 64));
    if (!floor) ctx.warn(c, ctx.building.pending().some((d) => d.id === msg.floor) ? "That floor is still being cloned — it'll be ready in a moment" : 'No such floor');
    else ctx.goToFloor(c, floor, arrivalSpot(msg.at));
  },
  'floor.repos'(ctx, c, msg) {
    void ctx.building.repos(msg.refresh === true).then(
      (repos) => ctx.sendTo(c, { t: 'floor.repos', repos }),
      (err: Error) => ctx.sendTo(c, { t: 'floor.repos', repos: [], error: `Couldn't list your repositories with gh: ${err.message}` }),
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
    if (id === LOBBY) return ctx.warn(c, 'The public lobby is the permanent ground floor');
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
} satisfies HandlerMap<FloorClientMsg>;
