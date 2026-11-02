import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * A worker's terminal opens a pinned tab for the page its provider points at (see
 * WorkerInfo.sessionUrl): a provider whose agent has a web UI of its own says where, and the office
 * opens it beside the terminal. This file stands a small DOM in before the client modules load, the
 * way client-store.test.ts stands localStorage in.
 */

// Enough of a DOM for the tab bar: elements are made, given attributes, and put inside one another.
class El {
  style: Record<string, string> = {};
  attrs = new Map<string, string>();
  classes = new Set<string>();
  children: El[] = [];
  parent: El | null = null;
  listeners = new Map<string, EventListener[]>();
  hidden = false;
  constructor(public tag: string, public id = '') {}
  set className(v: string) {
    this.classes = new Set(v.split(/\s+/).filter(Boolean));
  }
  get className() {
    return [...this.classes].join(' ');
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  addEventListener(k: string, fn: EventListener) {
    this.listeners.set(k, [...(this.listeners.get(k) ?? []), fn]);
  }
  append(...kids: unknown[]) {
    for (const k of kids) {
      if (k instanceof El) k.parent = this;
      this.children.push(k as El);
    }
  }
  replaceChildren(...kids: unknown[]) {
    for (const k of this.children) if (k instanceof El) k.parent = null;
    this.children = [];
    this.append(...kids);
  }
  fire(k: string, ev: Event = new Event(k)) {
    for (const fn of this.listeners.get(k) ?? []) fn(ev);
  }
  /** An element in here matching a tag, the first one, for finding the tabs and their frames. */
  find(tag: string, out: El[] = []): El[] {
    for (const c of this.children) {
      if (!(c instanceof El)) continue;
      if (c.tag === tag) out.push(c);
      c.find(tag, out);
    }
    return out;
  }
  classList = {
    add: (...cs: string[]) => cs.forEach((c) => this.classes.add(c)),
    remove: (...cs: string[]) => cs.forEach((c) => this.classes.delete(c)),
    toggle: (c: string, on?: boolean) => {
      const want = on ?? !this.classes.has(c);
      if (want) this.classes.add(c);
      else this.classes.delete(c);
      return want;
    },
    contains: (c: string) => this.classes.has(c),
  };
  closest(_sel: string) {
    return null;
  }
}

// `h` (src/client/ui/dom.ts) checks `child instanceof Node` to know what to append.
Object.defineProperty(globalThis, 'Node', { configurable: true, writable: true, value: El });
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    createElement: (tag: string) => new El(tag),
    activeElement: null,
  },
});
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
});
Object.defineProperty(globalThis, 'performance', { configurable: true, writable: true, value: { now: () => 0 } });
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: RO });
Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'http://office.local', protocol: 'http:', host: 'office.local' } });

const { termTabs } = await import('../src/client/ui/termtabs.js');
const { store } = await import('../src/client/state/index.js');

const SESSION = 'http://127.0.0.1:10369/p/p1/s/s1';

/** Opens a worker's terminal tabs, with that worker's state as the store holds it now. */
function openTabs(workerId: string, opts: { sessionUrl?: string } = {}) {
  return termTabs(workerId, { host: new El('div'), keypad: null, focusTerm: () => {}, ...opts });
}

/** A worker as `worker.update` brings one. */
const workerMsg = (id: string, extra: Record<string, unknown> = {}) =>
  ({ t: 'worker.update', worker: { id, name: id, kind: 'agent', status: 'working', deskId: 'd1', color: '#fff', createdAt: 1, cols: 80, rows: 24, ...extra } }) as never;

const frameSrcs = (tabs: { pages: El }) => tabs.pages.find('iframe').map((f) => f.getAttribute('src'));
const visibleFrames = (tabs: { pages: El }) => tabs.pages.find('iframe').filter((f) => !f.classes.has('hidden'));

test('a session the provider already reported is opened the moment the terminal is', () => {
  // Clicking a worker whose session has already started: the address is on the worker already, and
  // the terminal opens the page beside the terminal, right away.
  store.apply(workerMsg('w-have', { sessionUrl: SESSION }));
  const tabs = openTabs('w-have', { sessionUrl: SESSION });
  assert.deepEqual(visibleFrames(tabs).map((f) => f.getAttribute('src')), [SESSION], 'the session page is open');
});

test("the same address arriving again doesn't open a second tab", () => {
  const tabs = openTabs('w-twice');
  store.apply(workerMsg('w-twice', { sessionUrl: SESSION }));
  const first = frameSrcs(tabs);
  store.apply(workerMsg('w-twice', { sessionUrl: SESSION }));
  assert.deepEqual(frameSrcs(tabs), first, 'one tab, still');
  assert.equal(frameSrcs(tabs).length, 1);
});

test('a session reported after the terminal is open opens its tab then', () => {
  // A worker mid-boot, whose provider only learns where its session is once it has begun.
  const tabs = openTabs('w-late');
  assert.deepEqual(frameSrcs(tabs), [], 'no session yet');
  store.apply(workerMsg('w-late', { sessionUrl: SESSION }));
  assert.deepEqual(visibleFrames(tabs).map((f) => f.getAttribute('src')), [SESSION], 'the page arrives with the worker');
});

test('a worker with no session page has no tab of its own', () => {
  store.apply(workerMsg('w-none'));
  const tabs = openTabs('w-none');
  assert.deepEqual(tabs.pages.find('iframe'), [], 'nothing pinned');
});

test('a session page opens once, with the sandbox the other tabs have', () => {
  store.apply(workerMsg('w-frame', { sessionUrl: SESSION }));
  const tabs = openTabs('w-frame', { sessionUrl: SESSION });
  const frame = visibleFrames(tabs)[0]!;
  assert.ok(frame.getAttribute('sandbox'), 'it is sandboxed like any pinned page');
  assert.equal(frame.getAttribute('title'), 'Session');
  assert.equal(frameSrcs(tabs).length, 1, 'exactly one tab for it');
});
