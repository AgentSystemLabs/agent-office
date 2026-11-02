// The building's floors: opening every floor of the building and waiting for its workers, and
// watching for floors being added or taken off.
import { existsSync } from 'node:fs';
import { WebSocket } from 'ws';
import type { FloorInfo, ServerMsg } from '../../shared/protocol.js';
import { ROOF } from '../../shared/rooftop.js';
import type { FloorDef } from '../building.js';
import { Floor, type FloorContext } from '../floor.js';
import type { Client } from './client.js';
import type { Ctx, FloorHelpers, FloorsOpen } from './context.js';

/** A viewer taking more than this much memory waiting on a slow link is caught up with a fresh snapshot. */
const SLOW_CLIENT_BYTES = 10 * 1024 * 1024;

export function floorHelpers(ctx: Ctx): FloorHelpers {
  const floorOf = (c: Client): Floor | undefined => (c.peer.floor ? ctx.floors.get(c.peer.floor) : undefined);
  /** The floor a worker sits on. Worker ids are unique across the building. */
  const workerFloor = (workerId: string): Floor | undefined => {
    for (const f of ctx.floors.values()) if (f.workers.get(workerId)) return f;
    return undefined;
  };
  const floorInfos = (): FloorInfo[] => {
    const list: FloorInfo[] = [
      ...ctx.building.list().map((d) => {
        const f = ctx.floors.get(d.id);
        const info: FloorInfo = f
          ? { ...f.info(), ...(ctx.building.isLocal(f.id) ? { local: true } : {}) }
          : {
              id: d.id,
              name: d.name,
              repo: d.repo,
              dir: d.dir,
              palette: d.palette,
              addedBy: d.addedBy,
              addedAt: d.addedAt,
              workers: 0,
              busy: 0,
              waiting: 0,
              people: 0,
              wing: 0,
            };
        if (f) ctx.plugins?.decorateFloor(f, info);
        return info;
      }),
      ...ctx.building.pending().map((d) => ({
        id: d.id,
        name: d.name,
        repo: d.repo,
        dir: d.dir,
        palette: d.palette,
        addedBy: d.addedBy,
        addedAt: d.addedAt,
        cloning: true,
        clone: ctx.building.cloneProgress(d.id),
        workers: 0,
        busy: 0,
        waiting: 0,
        people: 0,
        wing: 0,
      })),
    ];
    return ctx.plugins ? ctx.plugins.sortFloors(list) : list;
  };
  // The elevator's counts change with every worker update; tell everyone at most a few times a second.
  let floorsSent = '';
  let floorsTimer: NodeJS.Timeout | undefined;
  const floorsChanged = () => {
    floorsTimer ??= setTimeout(() => {
      floorsTimer = undefined;
      const list = floorInfos();
      const json = JSON.stringify(list);
      if (json === floorsSent) return;
      floorsSent = json;
      ctx.broadcast({ t: 'floors', floors: list });
    }, 250);
  };
  /** Where someone arriving goes: the floor they asked for, else the first one there is. */
  const arrivalFloor = (wanted: string | null): Floor | undefined => {
    if (wanted === ROOF) return undefined;
    const floor = (wanted && ctx.floors.get(wanted)) || ctx.floors.get(ctx.building.list()[0]?.id ?? '');
    return floor;
  };

  /**
   * Takes `floor` off the building (already out of floors.json): everyone on it rides the elevator to
   * the next floor, or out to the lobby if it was the last (the roof goes with it), and its workers stop.
   */
  const closeFloor = (floor: Floor, who: string) => {
    const { name } = floor.def;
    const next = ctx.floors.get(ctx.building.list()[0]?.id ?? '');
    for (const c of ctx.clients.values()) {
      if (c.peer.floor === floor.id || (!next && c.peer.floor === ROOF)) {
        if (next) ctx.goToFloor(c, next);
        else ctx.toLobby(c);
        ctx.sendTo(c, { t: 'toast', text: next ? `🛗 ${who} took ${name} off the building, so you rode the elevator to ${next.def.name}` : `🛗 ${who} took ${name}, the last floor, off the building`, level: 'warn' });
      } else ctx.sendTo(c, { t: 'toast', text: `🛗 ${who} took ${name} off the building`, level: 'info' });
    }
    ctx.floors.delete(floor.id);
    floor.shutdown();
    floorsChanged();
    // Its workers made room under the worker limit.
    ctx.pumpQueues();
  };

  return { floorOf, workerFloor, floorInfos, floorsChanged, cancelFloorsChanged: () => clearTimeout(floorsTimer), arrivalFloor, closeFloor };
}

/**
 * Opens every floor of the building, with what they need of the office (see FloorContext), and waits
 * until the workers still running from the last office are back at their desks.
 */
export async function openFloors(ctx: Ctx, hookPort: number): Promise<FloorsOpen> {
  const { cfg, floors, clients } = ctx;
  const floorContext: FloorContext = {
    agentCmd: cfg.agentCmd,
    agentArgs: cfg.agentArgs,
    dshProfile: cfg.dshProfile,
    hook: { url: `http://127.0.0.1:${hookPort}`, token: '' },
    ledger: ctx.ledger,
    capacity: ctx.machine,
    prompts: ctx.prompts,
    issuesAdapter: () => ctx.plugins?.getIssuesAdapter(),
    pullsAdapter: () => ctx.plugins?.getPullsAdapter(),
    queueAdapter: () => ctx.plugins?.getQueueAdapter(),
    boardAdapters: () => ctx.plugins?.listBoardAdapters() ?? [],
    emit: ctx.toFloor,
    toast: ctx.toastFloor,
    termData: (workerId, data, viewers) => {
      const json = JSON.stringify({ t: 'term.data', workerId, data } satisfies ServerMsg);
      for (const id of viewers) {
        const c = clients.get(id);
        if (!c || c.ws.readyState !== WebSocket.OPEN) continue;
        // A viewer on a slow link skips output and gets a fresh snapshot once it catches up,
        // instead of queueing unbounded data in server memory.
        if (c.stale.has(workerId) || c.ws.bufferedAmount > SLOW_CLIENT_BYTES) c.stale.add(workerId);
        else c.ws.send(json);
      }
    },
    changes: (state, ids) => {
      for (const id of ids) {
        const c = clients.get(id);
        if (c) ctx.sendTo(c, { t: 'changes', state });
      }
    },
    workerChanged: (floor, w) => {
      if (typeof w === 'string') {
        ctx.webhook.onWorkerGone(w);
        ctx.pumpQueues(floor);
      } else ctx.webhook.onWorker(w);
      ctx.machine.workersChanged();
      ctx.floorsChanged();
    },
    people: (floor) => {
      let n = 0;
      for (const c of clients.values()) if (c.peer.floor === floor.id) n++;
      return n;
    },
    peers: (floor) => [...clients.values()].filter((c) => c.peer.floor === floor.id).map((c) => c.peer),
    leaveOnMerge: () => ctx.leaveOnMerge.on,
    floor: (id) => floors.get(id),
    pullsChanged: (floor) => {
      for (const f of floors.values()) if (f !== floor && worksIn(f, floor)) f.sendLandedHome();
    },
    lent: (floor) => [...floors.values()].some((f) => f !== floor && worksIn(f, floor)),
    locksUp: () => !!ctx.maps.plan().sendHome?.keeps,
    runAs: ctx.signins,
    ghAs: (owner) => (owner ? ctx.signins.ghAs(owner) : undefined),
  };

  /** Whether a worker on `from` works in `on`'s project too (see WorkerInfo.repos). */
  const worksIn = (from: Floor, on: Floor) => from.workers.list().some((w) => w.repos?.some((r) => r.floor === on.id));

  const openFloor = (def: FloorDef): Floor | undefined => {
    if (floors.has(def.id)) return floors.get(def.id);
    if (!existsSync(def.dir)) {
      console.error(`agent-office: the ${def.name} floor's checkout is gone (${def.dir}) — it stays closed until it's back`);
      return undefined;
    }
    try {
      const floor = new Floor(def, floorContext);
      floors.set(def.id, floor);
      return floor;
    } catch (err) {
      console.error(`agent-office: couldn't open the ${def.name} floor: ${(err as Error).message}`);
      return undefined;
    }
  };

  ctx.openFloor = openFloor;

  // External floor providers via plugins provide the floor list
  const floorProvider = ctx.plugins?.getFloorProvider();
  if (floorProvider) {
    const syncFloorProvider = async () => {
      try {
        const defs = await floorProvider.listFloors();
        if (defs && defs.length > 0) {
          const prevDefs = ctx.building.list();
          ctx.building.mergeList(defs);
          const currentDefs = ctx.building.list();
          if (JSON.stringify(prevDefs) !== JSON.stringify(currentDefs)) {
            for (const def of currentDefs) openFloor(def);
            ctx.floorsChanged();
          }
        }
      } catch {
        /* ignore */
      }
    };
    await syncFloorProvider();
    setInterval(() => {
      void syncFloorProvider();
      for (const floor of floors.values()) void floor.queue.syncFromAdapter();
    }, 3000).unref();
  }

  // Started in a project: it's a floor too (the one it has always been).
  if (cfg.project) ctx.building.ensureLocal(cfg.project, 'the office');
  for (const def of ctx.building.list()) openFloor(def);

  // Clones keep the elevator's progress up to date, and ones the last office left running carry on.
  ctx.building.watchClones(ctx.floorsChanged);
  ctx.building.resumeClones((r) => {
    ctx.floorsChanged();
    if (typeof r === 'string') {
      console.error(`agent-office: ${r}`);
      return ctx.toastAll(`🛗 ${r}`, 'warn');
    }
    if (!openFloor(r)) return;
    console.log(`  the ${r.name} floor's clone finished (${r.dir})`);
    ctx.toastAll(`🛗 New floor: ${r.name}, added by ${r.addedBy}`);
  });

  // Workers still running from the last office are back at their desks before anyone walks in.
  await Promise.all([...floors.values()].map((f) => f.ready));
  return { openFloor };
}
