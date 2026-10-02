/** Coalesces a burst of store updates and lets a closing view cancel pending work. */
export function coalescedUpdate(render: () => void, enqueue: (fn: () => void) => number, cancel: (id: number) => void) {
  let pending: number | undefined;
  return {
    schedule() {
      if (pending !== undefined) return;
      pending = enqueue(() => { pending = undefined; render(); });
    },
    cancel() {
      if (pending !== undefined) cancel(pending);
      pending = undefined;
    },
  };
}

/** Retains each row by key, updating only changed display values and pruning removed rows. */
export class KeyedRows<T, N> {
  private rows = new Map<string, { signature: string; node: N }>();

  reconcile(values: readonly T[], key: (value: T) => string, signature: (value: T) => string, create: (value: T) => N, update: (node: N, value: T) => void): N[] {
    const next = new Map<string, { signature: string; node: N }>();
    const result: N[] = [];
    for (const value of values) {
      const id = key(value);
      const sig = signature(value);
      let row = this.rows.get(id);
      if (!row) row = { signature: sig, node: create(value) };
      else if (row.signature !== sig) { update(row.node, value); row.signature = sig; }
      next.set(id, row);
      result.push(row.node);
    }
    this.rows = next;
    return result;
  }
}
