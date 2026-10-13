import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyBrief, integrationStatus } from '../src/client/ui/lobby.js';

const state = {
  workers: [{ status: 'working' }, { status: 'needs_input' }, { status: 'done' }],
  queue: [{ status: 'queued' }, { status: 'running' }, { status: 'done' }],
  alerts: [{ severity: 'urgent' }, { severity: 'watch' }],
  issues: [{ state: 'OPEN' }, { state: 'CLOSED' }],
  pulls: [{ state: 'OPEN' }],
  council: { status: 'running' },
};

test('daily brief summarizes actionable LokiDewa work', () => {
  assert.deepEqual(dailyBrief(state), {
    activeWorkers: 2,
    waitingWorkers: 1,
    openTasks: 2,
    alerts: 2,
    urgentAlerts: 1,
    openIssues: 1,
    openPulls: 1,
    councilActive: true,
  });
});

test('integration status never labels configured-only capabilities live', () => {
  const status = integrationStatus({
    floor: 'dewa',
    project: { agentProviders: ['hermes', 'muse'] },
    workers: [
      { provider: 'hermes', model: 'OLLAMA/qwen3.5:9b', status: 'working' },
      { provider: 'muse', status: 'done' },
    ],
  });
  assert.deepEqual(status, {
    server: 'LIVE',
    research: 'OFFLINE',
    qwen: 'LIVE',
    muse: 'CONFIGURED',
    remotion: 'PLANNED',
  });
});

test('research is live only when its own cards are on the board', () => {
  const base = { floor: 'dewa', project: { agentProviders: [] }, workers: [] };
  assert.equal(integrationStatus({ ...base, alerts: [] }).research, 'OFFLINE');
  assert.equal(integrationStatus({ ...base, alerts: [{ kind: 'convergence' }] }).research, 'OFFLINE');
  assert.equal(integrationStatus({ ...base, alerts: [{ kind: 'insider' }] }).research, 'LIVE');
});

test('nothing is reported live without real evidence', () => {
  const status = integrationStatus({ floor: null, project: null, workers: [], alerts: [] });
  assert.deepEqual(status, {
    server: 'OFFLINE',
    research: 'OFFLINE',
    qwen: 'OFFLINE',
    muse: 'OFFLINE',
    remotion: 'PLANNED',
  });
  assert.ok(!Object.values(status).includes('LIVE'));
});
