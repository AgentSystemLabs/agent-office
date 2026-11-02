// Enough of a DOM for the client's UI modules to run under node: elements are made, given
// attributes, and put inside one another, the way tests/support/css.mjs stands the stylesheets in.
// The client modules under test never look further into an element than this.
export class El {
  style = {};
  attrs = new Map();
  classes = new Set();
  children = [];
  parent = null;
  listeners = new Map();
  hidden = false;
  value = '';
  options = [];
  selectedOptions = [];
  constructor(tag, id = '') {
    this.tag = tag;
    this.id = id;
  }
  set className(v) {
    this.classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get className() {
    return [...this.classes].join(' ');
  }
  setAttribute(k, v) {
    this.attrs.set(k, String(v));
  }
  getAttribute(k) {
    return this.attrs.has(k) ? this.attrs.get(k) : null;
  }
  addEventListener(k, fn) {
    this.listeners.set(k, [...(this.listeners.get(k) ?? []), fn]);
  }
  append(...kids) {
    for (const k of kids) {
      if (k instanceof El) k.parent = this;
      this.children.push(k);
    }
  }
  replaceChildren(...kids) {
    for (const k of this.children) if (k instanceof El) k.parent = null;
    this.children = [];
    this.append(...kids);
  }
  fire(k, ev = new Event(k)) {
    for (const fn of this.listeners.get(k) ?? []) fn(ev);
  }
  /** An element anywhere in here with that tag, the first one it comes to. */
  find(tag, out = []) {
    for (const c of this.children) {
      if (!(c instanceof El)) continue;
      if (c.tag === tag) out.push(c);
      c.find(tag, out);
    }
    return out;
  }
  findBy(pred, out = []) {
    for (const c of this.children) {
      if (!(c instanceof El)) continue;
      if (pred(c)) out.push(c);
      c.findBy(pred, out);
    }
    return out;
  }
  classList = {
    add: (...cs) => cs.forEach((c) => this.classes.add(c)),
    remove: (...cs) => cs.forEach((c) => this.classes.delete(c)),
    toggle: (c, on) => {
      const want = on ?? !this.classes.has(c);
      if (want) this.classes.add(c);
      else this.classes.delete(c);
      return want;
    },
    contains: (c) => this.classes.has(c),
  };
  closest() {
    return null;
  }
  focus() {}
  setCustomValidity() {}
  reportValidity() {
    return true;
  }
}

/** Stands the DOM and the browser bits the client modules read, before they are imported. */
export function standDom({ origin = 'http://office.local', storage = new Map() } = {}) {
  Object.defineProperty(globalThis, 'Node', { configurable: true, writable: true, value: El });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (t) => new El(t), activeElement: null } });
  Object.defineProperty(globalThis, 'Event', { configurable: true, writable: true, value: class { constructor(type) { this.type = type; } } });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => void storage.set(k, String(v)),
      removeItem: (k) => void storage.delete(k),
    },
  });
  Object.defineProperty(globalThis, 'performance', { configurable: true, writable: true, value: { now: () => 0 } });
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin, protocol: `${origin.split(':')[0]}:`, host: origin.replace(/^\w+:\/\//, '') } });
  return new El('body');
}
