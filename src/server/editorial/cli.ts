import path from 'node:path';
import { backupEditorial, restoreEditorialBackup } from './backup.js';
import { EditorialRuntime, seededBrief } from './runtime.js';

export async function editorialCommand(args: string[]): Promise<number> {
  const command = args[0] || 'doctor';
  const dataDir = value(args, '--data-dir') || process.env.EDITORIAL_DATA_DIR || path.join(process.cwd(), '.agent-office');
  if (command === '--help' || command === 'help') {
    console.log(help());
    return 0;
  }
  if (command === 'doctor') return doctor(dataDir);
  if (command === 'snapshot') return snapshot(dataDir);
  if (command === 'backup') {
    const destination = value(args, '--destination') || path.join(dataDir, 'editorial-backups', new Date().toISOString().replace(/[:.]/g, '-'));
    console.log(JSON.stringify(backupEditorial(dataDir, destination), null, 2));
    return 0;
  }
  if (command === 'restore') {
    const source = args[1];
    if (!source) throw new Error('editorial restore needs a backup directory');
    restoreEditorialBackup(source, dataDir, args.includes('--force'));
    console.log(`Editorial backup restored into ${path.join(dataDir, 'editorial')}`);
    return 0;
  }
  if (command === 'demo') return demo(dataDir);
  console.error(`Unknown editorial command: ${command}`);
  console.log(help());
  return 2;
}

function doctor(dataDir: string): number {
  const runtime = new EditorialRuntime(dataDir, { ...process.env, EDITORIAL_PROVIDER: process.env.EDITORIAL_PROVIDER || 'mock' });
  try {
    const snapshot = runtime.snapshot();
    const supported = Number(process.versions.node.split('.')[0]) >= 22;
    console.log(JSON.stringify({ ok: supported, node: process.versions.node, dataDir, database: runtime.db.filePath, provider: runtime.provider.id, providerConfigured: runtime.provider.configured, projects: snapshot.projects.length, capabilities: snapshot.capabilities }, null, 2));
    return supported ? 0 : 1;
  } finally {
    runtime.shutdown();
  }
}

function snapshot(dataDir: string): number {
  const runtime = new EditorialRuntime(dataDir, { ...process.env, EDITORIAL_PROVIDER: process.env.EDITORIAL_PROVIDER || 'mock' });
  try {
    console.log(JSON.stringify(runtime.snapshot(), null, 2));
    return 0;
  } finally {
    runtime.shutdown();
  }
}

function demo(dataDir: string): number {
  const runtime = new EditorialRuntime(dataDir, { ...process.env, EDITORIAL_PROVIDER: 'mock' });
  try {
    const project = runtime.createProject(seededBrief(`Demo local ${new Date().toISOString().slice(0, 10)}`, { authorName: 'Autor de prueba', genre: 'cuento' }));
    const manuscript = runtime.documents.writeManuscript(project, '# Una obra breve\n\nEste texto pertenece a la demo local y no se publica.');
    const epub = runtime.documents.exportEpub(project, project.title, project.brief.authorName, '# Una obra breve\n\nEste texto pertenece a la demo local y no se publica.');
    const pdf = runtime.documents.exportPdf(project, project.title, '# Una obra breve\n\nEste texto pertenece a la demo local y no se publica.');
    const rendering = runtime.documents.writeRendering(project, project.title, '# Una obra breve\n\nEste texto pertenece a la demo local y no se publica.');
    const packageArtifact = runtime.documents.createPackage(project, [manuscript, epub, pdf, rendering], { mode: 'demo', published: false });
    const candidate = runtime.createReleaseCandidate(project.id, [manuscript, epub, pdf, rendering, packageArtifact], { mode: 'demo', externalPublication: false }, 'approved');
    console.log(JSON.stringify({ ok: true, published: false, projectId: project.id, releaseId: candidate.id, artifacts: runtime.repo.listArtifacts(project.id) }, null, 2));
    return 0;
  } finally {
    runtime.shutdown();
  }
}

function value(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function help(): string {
  return ['agent-office editorial <command>', '', 'Commands:', '  doctor                         Check Node, SQLite, provider and capabilities', '  snapshot                       Print the persisted editorial state', '  demo                           Create local mock artifacts; never publishes', '  backup --destination <dir>    Copy SQLite and private files', '  restore <dir> [--force]        Restore into --data-dir/editorial', '', 'Options:', '  --data-dir <dir>               Agent Office data directory (default .agent-office)', ''].join('\n');
}

