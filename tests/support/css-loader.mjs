// The loader hook css.mjs registers: any .css import is an empty module, and a model's .glb (imported for
// its URL, `?url`) is an empty URL.
export async function load(url, context, next) {
  const path = new URL(url).pathname;
  if (path.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
  if (path.endsWith('.glb')) return { format: 'module', source: 'export default "";', shortCircuit: true };
  return next(url, context);
}
