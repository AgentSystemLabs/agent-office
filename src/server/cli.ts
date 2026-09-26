import os from 'node:os';
import { loadConfig, ensureSelfSigned } from './config.js';
import { startServer } from './server.js';

const cfg = loadConfig(process.argv.slice(2));
await ensureSelfSigned(cfg);

let office: Awaited<ReturnType<typeof startServer>>;
try {
  office = await startServer(cfg);
} catch (err) {
  const e = err as NodeJS.ErrnoException;
  if (e.code === 'EADDRINUSE') console.error(`agent-office: port ${cfg.port} is already in use (try --port)`);
  else console.error(`agent-office: ${e.message}`);
  process.exit(1);
}

const scheme = cfg.tls ? 'https' : 'http';
const urls = new Set<string>([`${scheme}://localhost:${cfg.port}`]);
if (cfg.host === '0.0.0.0' || cfg.host === '::') {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) if (ni.family === 'IPv4' && !ni.internal) urls.add(`${scheme}://${ni.address}:${cfg.port}`);
  }
} else urls.add(`${scheme}://${cfg.host}:${cfg.port}`);

const agent = office.workers.resolvedAgent;
console.log(`
  🏢  agent-office is open for ${cfg.dir}

  ${[...urls].join('\n  ')}

  password: ${cfg.passwordGenerated ? cfg.password : '(from --password / AGENT_OFFICE_PASSWORD)'}
  workers run: ${[agent ?? `${cfg.agentCmd} (via login shell)`, ...cfg.agentArgs].join(' ')}
${cfg.tls ? '' : '\n  tip: voice & screen share need https off localhost — use a reverse proxy or --self-signed\n'}`);

let closing = false;
const stop = () => {
  if (closing) process.exit(1);
  closing = true;
  console.log('\n  closing the office…');
  office.shutdown();
  setTimeout(() => process.exit(0), 300);
};
// Last line of defense: one bad request must never take down every running worker.
process.on('unhandledRejection', (err) => console.error('agent-office: unhandled rejection', err));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
