// The whip: crack it at a worker on your floor and it flinches for everyone there, then gets the
// office's 'worker.whip' prompt, an optimization pass over what its branch and task have done so far.

/** How long a worker smarts after a lash before it can be whipped again (ms): one prompt per lash, not a flood. */
export const WHIP_COOLDOWN_MS = 20_000;

export type WhipClientMsg =
  /** Crack the whip at a worker on your floor (an agent that's running and not waiting on anyone). */
  { t: 'worker.whip'; workerId: string };

export type WhipServerMsg =
  /** Someone cracked the whip at a worker on your floor: `by` is their connection (PeerInfo.id), `name` what they're called. */
  { t: 'worker.whipped'; workerId: string; by: string; name: string };
