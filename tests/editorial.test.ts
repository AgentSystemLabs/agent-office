import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { restoreEditorialBackup } from '../src/server/editorial/backup.js';
import { EditorialDatabase } from '../src/server/editorial/db.js';
import { EditorialDocuments, validateEpub, validatePdf } from '../src/server/editorial/documents.js';
import { id } from '../src/server/editorial/ids.js';
import { allProfiles } from '../src/server/editorial/profiles.js';
import { EditorialOrchestrator } from '../src/server/editorial/orchestrator.js';
import { EditorialRepository } from '../src/server/editorial/repository.js';
import { EditorialRuntime, seededBrief } from '../src/server/editorial/runtime.js';
import { EditorialStorage } from '../src/server/editorial/storage.js';
import { OpenAIEditorialProvider } from '../src/server/editorial/providers.js';

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function contract(projectId: string, taskId = id('task')) {
  return { taskId, projectId, roleId: 'writer' as const, objective: 'Escribir una unidad de prueba', scope: 'demo', inputRevisionIds: [], dependencyTaskIds: [], acceptanceCriteria: ['resultado'], tools: ['artifact.write'], timeoutSeconds: 3, maxAttempts: 2, resultDestination: 'originals' };
}

test('editorial registers eleven profiles and keeps project state isolated', () => {
  assert.equal(allProfiles().length, 11);
  const root = tempDir('editorial-state');
  const db = new EditorialDatabase(path.join(root, 'editorial.sqlite'));
  try {
    const repo = new EditorialRepository(db);
    const first = repo.createProject(seededBrief('Primero'));
    const second = repo.createProject(seededBrief('Segundo'));
    repo.createRevision(first.id, 'brief', 'hash-first', { canon: ['uno'] });
    assert.equal(repo.listProjects().length, 2);
    assert.equal(repo.listRevisions(first.id).length, 1);
    assert.equal(repo.listRevisions(second.id).length, 0);
    assert.equal(repo.rememberTelegramUpdate(100), true);
    assert.equal(repo.rememberTelegramUpdate(100), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('documents, rights, audit and owner approval produce a non-publishing release', () => {
  const root = tempDir('editorial-release');
  const runtime = new EditorialRuntime(root, { EDITORIAL_PROVIDER: 'mock', TELEGRAM_OWNER_ID: '12345' });
  try {
    const project = runtime.createProject(seededBrief('Obra verificable', { authorName: 'Autora' }));
    const manuscript = runtime.documents.writeManuscript(project, '# Capítulo\n\nTexto editable.');
    const epub = runtime.documents.exportEpub(project, project.title, project.brief.authorName, '# Capítulo\n\nTexto EPUB.');
    const pdf = runtime.documents.exportPdf(project, project.title, '# Capítulo\n\nTexto PDF.');
    assert.equal(validateEpub(runtime.storage.read(epub.path)).ok, true);
    assert.equal(validatePdf(runtime.storage.read(pdf.path)).ok, true);
    const candidate = runtime.createReleaseCandidate(project.id, [manuscript, epub, pdf], { edition: 'digital' });
    const audit = runtime.auditReleaseCandidate(candidate.id);
    assert.equal(audit.approved, true);
    const requested = runtime.requestReleaseApproval(candidate.id);
    assert.equal(runtime.approveApproval(requested.record.id).state, 'approved');
    assert.equal(runtime.prepareApprovedRelease(candidate.id).state, 'assisted');
    assert.ok(runtime.repo.listRights(project.id).some((rights) => rights.artifactId === manuscript.id));
    assert.ok(runtime.repo.listFindings(project.id).every((finding) => finding.status === 'open' || finding.status === 'resolved'));
  } finally {
    runtime.shutdown();
    rmSync(root, { recursive: true, force: true });
  }
});

test('budget reservations are atomic and late task results cannot overwrite cancellation', async () => {
  const root = tempDir('editorial-queue');
  const db = new EditorialDatabase(path.join(root, 'editorial.sqlite'));
  const repo = new EditorialRepository(db);
  try {
    const project = repo.createProject(seededBrief('Cola'));
    repo.createTask(contract(project.id, 'task-a'));
    repo.createTask(contract(project.id, 'task-b'));
    repo.createTask(contract(project.id, 'task-c'));
    const firstReservation = repo.reserveBudget(project.id, 'task-a', 'mock', 0.8, 1);
    assert.ok(firstReservation);
    assert.equal(repo.reserveBudget(project.id, 'task-b', 'mock', 0.8, 1), undefined);
    repo.settleBudget(firstReservation!, { source: 'estimate', estimatedCostUsd: 0.1 });
    assert.ok(repo.reserveBudget(project.id, 'task-c', 'mock', 0.8, 1));
    repo.cancelTask('task-a', 'budget test');
    repo.cancelTask('task-b', 'budget test');
    repo.cancelTask('task-c', 'budget test');

    const task = contract(project.id);
    repo.createTask(task);
    const orchestrator = new EditorialOrchestrator(repo, {
      maxConcurrent: 1, budgetUsd: 5, leaseMs: 5000, pollMs: 10, owner: 'test', estimateCost: () => 0,
      executor: async (context) => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return { taskId: context.task.taskId, runId: context.runId, state: 'completed', actionSummary: 'late', provider: 'mock', profileVersion: '1', artifacts: [], findings: [], blockers: [], uncertainties: [], evidence: [], usage: { source: 'estimate' as const } };
      },
    });
    await orchestrator.pump();
    for (let attempt = 0; attempt < 20 && repo.getTask(task.taskId)?.state !== 'running'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(repo.getTask(task.taskId)?.state, 'running');
    assert.equal(orchestrator.cancel(task.taskId), true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(repo.getTask(task.taskId)?.state, 'cancelled');
    assert.equal(repo.listRuns()[0]?.status, 'cancelled');
    orchestrator.stop();
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('supervised mode leaves new tasks pending until the owner runs the queue', async () => {
  const root = tempDir('editorial-supervised');
  const runtime = new EditorialRuntime(root, { EDITORIAL_PROVIDER: 'mock', EDITORIAL_AUTONOMOUS_MODE: '0' });
  try {
    const project = runtime.createProject(seededBrief('Supervisado'));
    const task = runtime.createTask('owner', contract(project.id));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(runtime.repo.getTask(task.taskId)?.state, 'pending');
    await runtime.runPending(project.id);
    for (let attempt = 0; attempt < 40 && runtime.repo.getTask(task.taskId)?.state === 'running'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(runtime.repo.getTask(task.taskId)?.state, 'completed');
    assert.equal(runtime.snapshot().settings.autonomousMode, false);
  } finally {
    runtime.shutdown();
    rmSync(root, { recursive: true, force: true });
  }
});

test('autonomous mode starts the queue without a manual trigger', async () => {
  const root = tempDir('editorial-autonomous');
  const runtime = new EditorialRuntime(root, { EDITORIAL_PROVIDER: 'mock', EDITORIAL_AUTONOMOUS_MODE: '1' });
  try {
    runtime.start();
    const project = runtime.createProject(seededBrief('Autónomo'));
    const task = runtime.createTask('owner', contract(project.id));
    for (let attempt = 0; attempt < 80 && runtime.repo.getTask(task.taskId)?.state !== 'completed'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(runtime.repo.getTask(task.taskId)?.state, 'completed');
    assert.equal(runtime.snapshot().settings.autonomousMode, true);
  } finally {
    runtime.shutdown();
    rmSync(root, { recursive: true, force: true });
  }
});

test('owner can switch the current runtime between autonomous and supervised modes', () => {
  const root = tempDir('editorial-mode-switch');
  const runtime = new EditorialRuntime(root, { EDITORIAL_PROVIDER: 'mock', EDITORIAL_AUTONOMOUS_MODE: '0' });
  try {
    runtime.setAutonomousMode(true);
    assert.equal(runtime.config.autonomousMode, true);
    runtime.setAutonomousMode(false);
    assert.equal(runtime.config.autonomousMode, false);
  } finally {
    runtime.shutdown();
    rmSync(root, { recursive: true, force: true });
  }
});

test('OpenAI adapter sends documented request shape without calling a real service', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const provider = new OpenAIEditorialProvider({ apiKey: 'api-key-test-only', baseUrl: 'https://example.invalid/v1', fetchImpl: async (input, init = {}) => {
    requests.push({ url: String(input), init });
    if (String(input).endsWith('/images/generations')) return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('test-image').toString('base64') }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ output_text: 'texto de prueba', usage: { input_tokens: 3, output_tokens: 4 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }});
  const text = await provider.generateText({ systemPrompt: 'sistema', prompt: 'usuario', model: 'model-test' });
  const image = await provider.generateImage({ prompt: 'imagen', model: 'image-test' });
  assert.equal(text.text, 'texto de prueba');
  assert.equal(new TextDecoder().decode(image.bytes), 'test-image');
  assert.equal(requests.length, 2);
  assert.match(String(requests[0].init.headers && (requests[0].init.headers as Record<string, string>).authorization), /^Bearer api-key-test-only$/);
});

test('backup restores a separate private editorial store', () => {
  const root = tempDir('editorial-backup-source');
  const restored = tempDir('editorial-backup-restored');
  const backup = tempDir('editorial-backup-copy');
  const runtime = new EditorialRuntime(root, { EDITORIAL_PROVIDER: 'mock' });
  try {
    runtime.createProject(seededBrief('Persistente'));
    const manifest = runtime.backup(backup);
    assert.ok(manifest.files.some((file) => file.endsWith('editorial.sqlite')));
  } finally {
    runtime.shutdown();
  }
  restoreEditorialBackup(backup, restored);
  const reopened = new EditorialRuntime(restored, { EDITORIAL_PROVIDER: 'mock' });
  try {
    assert.equal(reopened.snapshot().projects.length, 1);
    assert.equal(reopened.snapshot().projects[0].title, 'Persistente');
  } finally {
    reopened.shutdown();
    rmSync(root, { recursive: true, force: true });
    rmSync(restored, { recursive: true, force: true });
    rmSync(backup, { recursive: true, force: true });
  }
});

test('Mastodon connector marks a post only after a remote id and owner approval', async () => {
  const root = tempDir('editorial-social');
  const runtime = new EditorialRuntime(root, { EDITORIAL_PROVIDER: 'mock', MASTODON_BASE_URL: 'https://social.example', MASTODON_ACCESS_TOKEN: 'token-test-only' }, { fetchImpl: async () => new Response(JSON.stringify({ id: 'remote-1', url: 'https://social.example/@owner/remote-1' }), { status: 200, headers: { 'content-type': 'application/json' } }) });
  try {
    const project = runtime.createProject(seededBrief('Social'));
    const post = runtime.marketing.createPost(project, 'Mensaje autorizado');
    await assert.rejects(() => runtime.marketing.publishPost(post.id), /approval/i);
    assert.equal(runtime.marketing.approvePost(post.id), true);
    const published = await runtime.marketing.publishPost(post.id);
    assert.equal(published.state, 'published');
  } finally {
    runtime.shutdown();
    rmSync(root, { recursive: true, force: true });
  }
});
