#!/usr/bin/env node
// Isolated Pocket preview with a scripted model. Never reads or changes live Pocket data.
import { createServer } from 'node:http';
import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const pocketRoot = process.env.PI_POCKET_ROOT ?? '/opt/pi-pocket';
// Import helpers FIRST: they point Pocket at temporary data and fake auth.
const helpers = await import(pathToFileURL(join(pocketRoot, 'test/helpers.ts')).href);
const { cleanUp, newSession, openApp, root, say, scriptedModel, owner, lastText, context } = helpers;
const { fauxAssistantMessage, fauxToolCall, fauxText } = await import(pathToFileURL(join(pocketRoot, 'node_modules/@earendil-works/pi-ai/dist/providers/faux.js')).href);
const { createHandler } = await import(pathToFileURL(join(pocketRoot, 'src/server/http.ts')).href);
const dropIns = join(root, 'data/extensions');
await mkdir(dropIns, { recursive: true });
await cp(join(import.meta.dirname, 'office-v2.ts'), join(dropIns, 'office-v2.ts'));
await cp(join(import.meta.dirname, 'office-v2-client'), join(dropIns, 'office-v2-client'), { recursive: true });
const app = await openApp(scriptedModel((request) => {
  const last = lastText(request);
  return last.role === 'user' && last.text === 'office tool check'
    ? fauxAssistantMessage([fauxToolCall('bash', {command:'printf office-tool-ok'})], {stopReason:'toolUse'})
    : fauxAssistantMessage([fauxText(`echo: ${last.text}`)]);
}));
await app.setExtensionEnabled(owner(app), 'office-v2.ts', true);
app.loader.watch();
const session = await newSession(app);
await say(app, session, 'Office v2 isolated runtime preview');
const other = await newSession(app);
await say(app, other, 'Workspace switch test project');
const guest = app.config.addUser('Office teammate', 'guest');
const requestedPort = Number(process.env.OFFICE_POCKET_PREVIEW_PORT ?? 8899);
const host = '127.0.0.2';
const server = createServer(createHandler({ app, listen: { host, port:requestedPort }, restart: () => {} }));
await new Promise((resolve) => server.listen(requestedPort, host, resolve));
const port = server.address().port;
const base = `http://${host}:${port}`;
console.log(`Office v2 isolated Pocket preview. Scripted model only. Data: ${root}`);
console.log(`Owner: http://${host}:${port}/login?token=${encodeURIComponent(app.config.ownerToken)}&next=/s/${session}`);
console.log(`Guest: http://${host}:${port}/login?token=${encodeURIComponent(guest.token)}&next=/s/${session}`);
console.log(`Other workspace: http://${host}:${port}/s/${other}`);
console.log(`Source session: ${session}. Stop and remove temporary data with kill ${process.pid}.`);
let stopping = false;
async function closePreview() {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections(); server.close();
  await app.close(); cleanUp();
}
async function stop() { await closePreview(); process.exit(0); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
export { app, base, root, session, other, guest, owner, context, closePreview };
