// The building's floors: riding the elevator between them and up to the roof, and adding and taking
// off floors.
import { execFile } from 'node:child_process';
import type { FloorClientMsg } from '../../../shared/protocol.js';
import { ROOF } from '../../../shared/rooftop.js';
import { arrivalSpot, str } from '../../office/input.js';
import type { HandlerMap, ViewPieces } from './types.js';

/** `gh repo create`: a private repository with a README, answered with its owner/name (or why not). */
function createRepo(name: string): Promise<{ repo: string } | { error: string }> {
  return new Promise((done) => {
    if (!/^([\w.-]+\/)?[\w.-]{1,100}$/.test(name)) return done({ error: 'A repository name is letters, numbers, dots, dashes and underscores' });
    execFile('gh', ['repo', 'create', name, '--private', '--add-readme'], { timeout: 60_000 }, (err, out, errOut) => {
      if (err) return done({ error: `Couldn't create ${name} on GitHub: ${(errOut || err.message).trim().split('\n')[0]}` });
      const m = /github\.com\/([\w.-]+\/[\w.-]+)/.exec(out);
      done(m ? { repo: m[1].replace(/\.git$/, '') } : { error: `Created ${name}, but gh didn't say where` });
    });
  });
}

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
    void ctx.building.repos(msg.refresh === true).then(
      (repos) => ctx.sendTo(c, { t: 'floor.repos', repos }),
      (err: Error) => ctx.sendTo(c, { t: 'floor.repos', repos: [], error: `Couldn't list your repositories with gh: ${err.message}` }),
    );
  },
  'floor.add'(ctx, c, msg) {
    const who = c.peer.name;
    const asked = str(msg.repo, 200);
    void (msg.create ? createRepo(asked) : Promise.resolve({ repo: asked })).then((made) => {
      if ('error' in made) return ctx.sendTo(c, { t: 'floor.added', repo: asked, error: made.error });
      if (msg.create) ctx.toastAll(`🛗 ${who} created ${made.repo} on GitHub`);
      addFloor(made.repo);
    });
    const addFloor = (repo: string) =>
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
        if (typeof r === 'string') return ctx.sendTo(c, { t: 'floor.added', repo: asked, error: r });
        const floor = ctx.openFloor(r);
        if (!floor) return ctx.sendTo(c, { t: 'floor.added', repo: asked, error: `Cloned ${r.repo}, but couldn't open its floor — see the office's log` });
        console.log(`  ${who} added a floor for ${r.repo} (${r.dir})`);
        ctx.toastAll(`🛗 New floor: ${r.name}, added by ${who}`);
        ctx.sendTo(c, { t: 'floor.added', repo: asked, floor: floor.id });
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
} satisfies HandlerMap<FloorClientMsg>;
