import { childEnv, resolveCommand } from '../workers.js';
import { SignIns } from '../signins.js';
import { agentProviders, configuredProvider } from '../agents.js';
import { Tailnet } from '../tailnet.js';
import { Team } from '../team.js';
import { Upgrader } from '../upgrade.js';
import { Services } from '../services.js';
import { ImageProxy } from '../decor.js';
import { Ledger } from '../usage.js';
import { PlanLimitsReader } from '../limits.js';
import { Webhook } from '../webhook.js';
import { Machine } from '../machine.js';
import type { Floor } from '../floor.js';
import { Sky } from '../sky.js';
import { Themes } from '../theme.js';
import { Maps } from '../maps.js';
import { OfficePrompts } from '../prompts.js';
import { LeaveOnMerge } from '../leave-on-merge.js';
import type { ServiceInfo, ServicesState } from '../../shared/protocol.js';
import type { BuildingServices, Ctx, LateServices } from './context.js';
import type { Client } from './client.js';

/** What the whole building shares, made before any floor opens: the sky, ⚙️ Settings, spend, sign-ins, limits. */
export function createServices(ctx: Ctx): BuildingServices {
  const { cfg, accounts, clients, floors } = ctx;
  // Day, night and the weather outside the windows, the same for everyone.
  const sky = new Sky({ city: cfg.city, weather: cfg.weather }, (state) => ctx.broadcast({ t: 'sky', state }));
  sky.start();
  // Halloween or Christmas all over the building, the same for everyone (⚙️ Settings). On 'auto' it
  // goes by the calendar at the office, the sky's clock.
  const themes = new Themes(cfg.dataDir, () => sky.state.utcOffset, (state) => ctx.broadcast({ t: 'theme', state }));
  themes.start();
  // What the building looks like inside: the office, the castle, or a map of your own (⚙️ Settings).
  const maps = new Maps(cfg.dataDir);
  // The prompts the office writes for workers by itself, and the worker everyone starts on (⚙️ Settings).
  const configured = configuredProvider(cfg.agentCmd);
  const prompts = new OfficePrompts(cfg.dataDir, { list: agentProviders(configured), configured }, (state) => ctx.broadcast({ t: 'prompts', state }));
  // Whether a worker whose pull request merged goes home by itself, on every floor (⚙️ Settings).
  const leaveOnMerge = new LeaveOnMerge(cfg.dataDir, (state) => ctx.broadcast({ t: 'leaveOnMerge', state }));

  // What the workers spend, all time and today, with the optional daily budget.
  const ledger = new Ledger(
    cfg.dataDir,
    { budget: cfg.budget, pauseHiring: cfg.budgetPause },
    (state) => ctx.broadcast({ t: 'usage', state }),
    ctx.toastAll,
  );

  const claudeBin = configuredProvider(cfg.agentCmd) === 'claude' ? resolveCommand(cfg.agentCmd) : resolveCommand('claude');
  // Everyone with an account runs on their own Claude and GitHub sign-ins (see signins.ts). On the
  // shared password, with no accounts, the office's own are used, as they always were.
  const signins = new SignIns(
    cfg.dataDir,
    claudeBin,
    resolveCommand('gh'),
    childEnv,
    (id) => accounts.get(id)?.role === 'admin',
    (id) => {
      for (const c of clients.values()) if (c.accountId === id && !c.out) ctx.sendTo(c, { t: 'signins', state: signins.state(id) });
    },
  );
  // Accounts revoked from the terminal while the office was closed leave their sign-ins behind.
  if (!accounts.unreadableFile) signins.prune(new Set(accounts.state(new Set()).accounts.map((a) => a.id)));

  // The Claude plan's 5-hour and weekly limits, for the meter under the workers: the office's own
  // plan, and each account's own once it runs on a Claude sign-in of its own.
  const limits = new PlanLimitsReader(
    claudeBin,
    childEnv(),
    () => [...clients.values()].some((c) => limitsOf(c) === limits),
    (state) => {
      for (const c of clients.values()) if (limitsOf(c) === limits) ctx.sendTo(c, { t: 'limits', state });
    },
  );
  const accountLimits = new Map<string, { key: string; reader: PlanLimitsReader }>();
  /** Whose plan `c` sees: their own, on an account with its own Claude sign-in; else the office's. */
  const limitsOf = (c: Client): PlanLimitsReader => {
    const id = c.accountId;
    const key = id && signins.claudeKey(id);
    if (!id || !key) return limits;
    let a = accountLimits.get(id);
    if (a?.key !== key) {
      a?.reader.close();
      const reader = new PlanLimitsReader(
        claudeBin,
        signins.apply(id, childEnv(), [], 'claude'),
        () => [...clients.values()].some((o) => o.accountId === id),
        (state) => {
          for (const o of clients.values()) if (o.accountId === id) ctx.sendTo(o, { t: 'limits', state });
        },
      );
      a = { key, reader };
      accountLimits.set(id, a);
    }
    return a.reader;
  };

  // Slack / Discord pings for workers that need input or finish (set from ⚙️ Settings or --webhook).
  const webhook = new Webhook(cfg.dataDir, (workerId) => (workerId && ctx.workerFloor(workerId)?.def.name) || ctx.officeName, (state) => ctx.broadcast({ t: 'notify', state }));
  if (cfg.webhook !== undefined) {
    const err = webhook.set(cfg.webhook, 'the command line');
    if (err) console.error(`agent-office: --webhook: ${err}`);
  }

  // The machine's CPU and memory, for the monitor on the wall and a warning before hiring, and the
  // most workers the office runs at once, across every floor (--max-workers, or ⚙️ Settings).
  const machine = new Machine(
    cfg.dataDir,
    cfg.maxWorkers,
    () => {
      let n = 0;
      for (const f of floors.values()) n += f.workers.list().length;
      return n;
    },
    (state) => ctx.broadcast({ t: 'machine', state }),
  );
  machine.start();
  /** Queues everywhere may be waiting for room under the worker limit: let them look again. */
  const pumpQueues = (except?: Floor) => {
    if (machine.limit === undefined) return;
    // Not right now: whoever freed the seat (a queue making room for its next task) takes it first.
    setImmediate(() => {
      for (const f of floors.values()) if (f !== except) f.queue.pump();
    });
  };

  return { sky, themes, maps, prompts, leaveOnMerge, ledger, signins, limits, accountLimits, webhook, machine, limitsOf, pumpQueues };
}

/** What's made once the floors are open: the SSH team, the tailnet, workers' web servers, pictures and upgrades. */
export function createLateServices(ctx: Ctx): LateServices {
  const { cfg, clients, floors } = ctx;
  const team = new Team(cfg.publicHost, cfg.port, cfg.tailnet);
  const tailnet = new Tailnet(cfg.tailnet);

  // Web servers the workers start, for the Services board and service tunnels (see relay.ts).
  // One scan covers every floor; each floor's board lists its own workers' servers.
  const servicesState = (floor: Floor | undefined, items: ServiceInfo[] = services.list()): ServicesState => ({
    items: floor ? items.filter((s) => floor.workers.get(s.workerId)) : [],
    port: cfg.port,
    deploy: cfg.deployScript,
    ssh: team.ssh,
    tailnet: cfg.tailnet,
  });
  const services = new Services(
    () => [...floors.values()].flatMap((f) => f.workers.owners()),
    (items) => {
      for (const c of clients.values()) ctx.sendTo(c, { t: 'services', state: servicesState(ctx.floorOf(c), items) });
      tailnet.sync(items.map((s) => s.port));
    },
  );

  const images = new ImageProxy();

  const upgrader = new Upgrader(
    (state) => ctx.broadcast({ t: 'upgrade', state }),
    () => {
      // cli.ts shuts down gracefully, leaving the workers running in their terminal host; systemd
      // (Restart=always) then starts the new version, which picks them back up.
      process.kill(process.pid, 'SIGTERM');
    },
  );
  return { team, tailnet, services, images, upgrader, servicesState };
}
