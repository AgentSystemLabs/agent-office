// What `agent-office tunnel` and the office say to each other: the client asks which web servers
// the workers are running (GET /api/services), listens on each one's port on its own computer, and
// sends what arrives there to the office, which relays it to that server (relay.ts).

/** Where the client asks for the list. */
export const FORWARDS_PATH = '/api/services';

/**
 * Names the worker's server a request is for. The client reaches the office at whatever address
 * the office has (an SSH tunnel, a domain, a tailnet), where the Host header can't always say.
 */
export const SERVICE_HEADER = 'x-agent-office-service';

/** A worker's web server, as the client shows it in its terminal. */
export interface Forward {
  port: number;
  /** Its page's <title>, or its command line when it has none. */
  title: string;
  /** Its command line, shortened, e.g. "vite --port 5173". */
  command: string;
  /** The worker who started it. */
  worker?: string;
  /** The floor that worker is on. */
  floor?: string;
}

export interface ForwardList {
  /** The office's own port on its machine. */
  port: number;
  items: Forward[];
}

/** A Host a browser on this computer would send: localhost, 127.0.0.1, [::1] or <name>.localhost, with or without a port. */
export const LOOPBACK_NAME = /^(?:localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(?::\d{1,5})?$/i;
