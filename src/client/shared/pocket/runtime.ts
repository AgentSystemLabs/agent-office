/** srcdoc keeps the parent's origin; it does not have its own URL or hash. */
export function pocketRuntime(): boolean {
  return typeof document !== 'undefined' && document.querySelector('meta[name="pocket-runtime"]')?.getAttribute('content') === '1';
}

export function pocketChannel(): string {
  return document.querySelector('meta[name="pocket-channel"]')?.getAttribute('content') ?? '';
}

/** The regular fallback navigates to /lite, which is not a Pocket extension route. */
export function pocketNoWebGL(): Promise<never> {
  const error = document.createElement('div');
  error.setAttribute('role', 'alert');
  error.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#18202b;color:white;padding:2rem;font:18px system-ui';
  error.textContent = 'This device cannot start the 3D Office. WebGL is required. Use native Pocket chat instead.';
  document.body.append(error);
  return new Promise(() => {});
}

/** Keep legacy UI requests away from Pocket APIs and external services. */
export function installPocketBoundary() {
  if (!pocketRuntime()) return;
  const original = window.fetch.bind(window);
  const origin = new URL(document.baseURI).origin;
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, document.baseURI);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return Promise.resolve(new Response(JSON.stringify({ error: 'This Office action is unsupported in Pocket. Use native Pocket chat.' }), {
        status: 501, headers: { 'content-type': 'application/json' },
      }));
    }
    // An allowed same-origin asset must not redirect to another origin or an API.
    return original(input, { ...init, mode: 'same-origin', redirect: 'error' });
  };
}
