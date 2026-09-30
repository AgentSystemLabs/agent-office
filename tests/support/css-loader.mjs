// The loader hook css.mjs registers: any .css import is an empty module.
export async function load(url, context, next) {
  if (new URL(url).pathname.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
  return next(url, context);
}
