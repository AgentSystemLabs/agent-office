import test from 'node:test';
// The board repaint runs on its own timer (3s in the office); tests shorten it.
process.env['AGENT_OFFICE_SERVICES_TEST_MS'] = '30';
import assert from 'node:assert/strict';
import { createLateServices } from '../src/server/office/services.js';
import type { Ctx } from '../src/server/office/context.js';
import type { ServiceInfo, ServicesState } from '../src/shared/protocol.js';

/**
 * The Services board shows what a plugin's services provider lists, next to what the office's own
 * port scan finds: any plugin declaring the 'services' capability feeds the board.
 */

/** A floor good enough for the services board: its workers own the servers the scan credits to them. */
const FLoor = {
  workers: {
    get: (id: string) => (id ? { id } : undefined),
  },
};

/** What a browser on a floor is sent when the Services board is published. */
interface Sent {
  msg: { t: string; state: ServicesState };
}

/** A Ctx with the services pieces createLateServices needs, plus a plugin answer and an outbox. */
function ctxWith(pluginServices: ServiceInfo[] | null, opts: { throwIt?: boolean } = {}): { ctx: Ctx; sent: Sent[] } {
  const sent: Sent[] = [];
  const ownWorkers = [{ workerId: 'w-own', pid: 4242, agent: false, cwd: '/p', root: '/p' }];
  const client = { accountId: 'acct-1', peer: { floor: 'floor-1' } };
  const ctx = {
    cfg: { port: 4600, deployScript: undefined, tailnet: false, publicHost: 'localhost' },
    clients: { values: () => [client] },
    floors: {
      values: () => [{ id: 'floor-1', workers: { owners: () => ownWorkers } }],
    },
    floorOf: () => FLoor,
    sendTo: (_c: unknown, msg: Sent['msg']) => sent.push({ msg }),
    plugins: {
      listServices: async () => {
        if (opts.throwIt) throw new Error('plugin exploded');
        return pluginServices;
      },
    },
  } as unknown as Ctx;
  return { ctx, sent };
}

const openFoxService: ServiceInfo = {
  port: 4100,
  host: 'localhost',
  pid: 9,
  command: 'openfox dev',
  workerId: 'w-openfox',
  cwd: '/p',
  title: 'OpenFox (Stopped)',
  since: 0,
};

test("a plugin's services show up on the floor's Services board", async () => {
  const { ctx, sent } = ctxWith([openFoxService]);
  const { services } = createLateServices(ctx);
  // The scan publishes, then the plugin's rows are merged in and pushed to the floor.
  services.start();
  await new Promise((r) => setTimeout(r, 200));
  services.stop();
  const board = sent.map((s) => s.msg).filter((m) => m.t === 'services').at(-1);
  assert.ok(board, `no services message in ${JSON.stringify(sent.map((s) => s.msg.t))}`);
  assert.equal(board.state.items.length, 1);
  assert.equal(board.state.items[0]!.port, 4100);
  assert.equal(board.state.items[0]!.workerId, 'w-openfox');
  assert.equal(board.state.items[0]!.title, 'OpenFox (Stopped)');
});

test("with no plugin, the board is the office's own scan and nothing more", async () => {
  const { ctx, sent } = ctxWith(null);
  const { services } = createLateServices(ctx);
  services.start();
  await new Promise((r) => setTimeout(r, 200));
  services.stop();
  const boards = sent.map((s) => s.msg).filter((m) => m.t === 'services');
  for (const b of boards) assert.deepEqual(b.state.items, []);
});

test('a plugin that throws does not take the board down', async () => {
  const { ctx, sent } = ctxWith([], { throwIt: true });
  const { services } = createLateServices(ctx);
  services.start();
  await new Promise((r) => setTimeout(r, 200));
  services.stop();
  for (const b of sent.map((s) => s.msg).filter((m) => m.t === 'services')) assert.ok(Array.isArray(b.state.items));
});
