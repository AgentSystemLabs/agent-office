const LOCAL_OFFICE = 'http://127.0.0.1:4600';

/** A public Office opened through a reverse tunnel cannot infer which browser runs on its host. */
export function findLocalOffice(timeoutMs = 1500): Promise<string | undefined> {
  if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') return Promise.resolve(location.origin);
  return new Promise(resolve => {
    const image = new Image();
    let finished = false;
    const done = (origin?: string) => { if (finished) return; finished = true; clearTimeout(timer); image.onload = image.onerror = null; resolve(origin); };
    const timer = setTimeout(() => done(), timeoutMs);
    image.onload = () => done(LOCAL_OFFICE);
    image.onerror = () => done();
    image.src = LOCAL_OFFICE + '/favicon.svg?local-office-probe=' + Date.now();
  });
}

export function downloadAddress(path: string, localOffice?: string): string {
  return localOffice ? new URL(path, localOffice).href : path;
}
