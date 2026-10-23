export function worldDocument(html, assetRoot, channel, bootstrap, errorScript) {
  if (!Array.isArray(bootstrap.floors) || !bootstrap.floors.some((floor) => floor.id === bootstrap.snapshot.source)) throw new Error('The selected chat floor is no longer available.');
  const meta = `<meta name="pocket-runtime" content="1"><meta name="pocket-channel" content="${channel}"><meta name="pocket-bootstrap" content="${encodeURIComponent(JSON.stringify(bootstrap))}"><script src="${errorScript}"></script>`;
  // Pocket deliberately forbids <base>. Resolve only trusted packaged relative asset references.
  return html.replace(/\b(src|href)="(\.\/[^\"]+)"/g, (_all, attribute, path) => `${attribute}="${new URL(path, assetRoot).href}"`).replace('<head>', `<head>${meta}`);
}
