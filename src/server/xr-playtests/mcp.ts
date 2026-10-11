/** Bounded MCP SSE client for the Operator's ADB-forwarded loopback endpoint. */
export class OperatorClient {
  private abort = new AbortController();
  private endpoint?: URL;
  private sequence = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private base: string) {}
  async connect() {
    // Bound the initial HTTP handshake too; the SSE stream itself remains long-lived.
    const headersTimer = setTimeout(() => this.close(), 4000);
    let response: Response;
    try { response = await fetch(this.base + '/sse', { signal: this.abort.signal, redirect: 'error' }); }
    finally { clearTimeout(headersTimer); }
    if (!response.ok || !response.body) throw new Error('Operator SSE nicht erreichbar');
    let ready!: () => void, fail!: (e: Error) => void;
    const connected = new Promise<void>((resolve, reject) => { ready = resolve; fail = reject; });
    const timer = setTimeout(() => { fail(new Error('Operator endpoint timeout')); this.close(); }, 4000);
    void (async () => {
      const reader = response.body!.getReader(), decoder = new TextDecoder(); let buffer = '';
      try {
        while (true) {
          const next = await reader.read(); if (next.done) throw new Error('Operator getrennt');
          buffer += decoder.decode(next.value, { stream: true }).replace(/\r/g, '');
          if (buffer.length > 512000) throw new Error('Operator message too large');
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const type = event.match(/^event: *(.*)$/m)?.[1];
            const data = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
            if (type === 'endpoint') {
              const url = new URL(data, this.base);
              if (url.origin !== new URL(this.base).origin) throw new Error('Invalid Operator endpoint');
              this.endpoint = url; clearTimeout(timer); ready();
            } else if (data) {
              const message = JSON.parse(data), task = this.pending.get(message.id);
              if (task) { clearTimeout(task.timer); this.pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); }
            }
          }
        }
      } catch (e) { clearTimeout(timer); fail(e as Error); this.close(); }
    })();
    await connected;
    await this.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'office-playtests', version: '1.0' } });
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const list = await this.rpc('tools/list', {});
    for (const name of ['ZRB_PlaytestSnapshot', 'ZRB_PlaytestOverlay']) {
      if (!list.tools?.some((t: { name: string }) => t.name === name)) throw new Error(`Development-Build benötigt ${name}`);
    }
  }
  private async post(body: unknown) {
    if (!this.endpoint) throw new Error('Operator nicht verbunden');
    const response = await fetch(this.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(4000)]), redirect: 'error' });
    if (!response.ok) throw new Error(`Operator HTTP ${response.status}`);
  }
  private rpc(method: string, params: unknown): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Operator timeout')); }, 4000);
      this.pending.set(id, { resolve, reject, timer });
      void this.post({ jsonrpc: '2.0', id, method, params }).catch(e => { clearTimeout(timer); this.pending.delete(id); reject(e); });
    });
  }
  async call(name: 'ZRB_PlaytestSnapshot' | 'ZRB_PlaytestOverlay' | 'ZRB_PlaytestPrepare', args: Record<string, unknown> = {}) {
    const result = await this.rpc('tools/call', { name, arguments: args });
    if (result.isError) throw new Error('Operator-Werkzeug meldet einen Fehler');
    if (result.structuredContent) return result.structuredContent;
    const text = result.content?.filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('\n');
    return JSON.parse(text || '{}');
  }
  close() {
    this.abort.abort();
    for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(new Error('Operator getrennt')); }
    this.pending.clear();
  }
}
