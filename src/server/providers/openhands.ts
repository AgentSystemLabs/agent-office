// OpenHands Agent Canvas has a local authenticated API, but no installed interactive CLI. A small
// terminal bridge gives Agent Office a persistent PTY and reports the same lifecycle as OpenCode.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { OpenCodeStatusEvent } from '../opencode.js';
import type { WorkerHandle } from '../workers/types.js';
import { truncate } from '../workers/util.js';
import { OPENHANDS_BRIDGE_SOURCE } from './openhands-bridge.js';
import { reduceStatus, type StatusState } from './opencode.js';
import type { ProviderAdapter } from './types.js';

interface OpenHandsSetup { bridge: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function statusEvent(value: unknown): value is OpenCodeStatusEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.sessionId === 'string' && UUID.test(v.sessionId)
    && typeof v.type === 'string' && ['session', 'prompt', 'tool', 'permission', 'question', 'error'].includes(v.type)
    && typeof v.status === 'string' && ['starting', 'working', 'needs_input', 'done'].includes(v.status)
    && (v.prompt === undefined || typeof v.prompt === 'string')
    && (v.tool === undefined || typeof v.tool === 'string')
    && (v.detail === undefined || typeof v.detail === 'string');
}

function openHandsHook(h: WorkerHandle<StatusState>, _event: string, payload: unknown): boolean {
  if (!statusEvent(payload)) return false;
  const accepted = reduceStatus(h, payload, { idleOnStart: true });
  if (accepted && payload.type === 'tool' && payload.tool) h.noteTool(truncate(payload.tool, 80));
  return accepted;
}

export const openhands: ProviderAdapter<StatusState, OpenHandsSetup> = {
  id: 'openhands',
  createState: () => ({}),
  prepare({ dataDir }) {
    const dir = path.join(dataDir, 'openhands');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const bridge = path.join(dir, 'bridge.mjs');
    writeFileSync(bridge, OPENHANDS_BRIDGE_SOURCE, { mode: 0o600 });
    chmodSync(bridge, 0o600);
    return { bridge };
  },
  launch({ cwd, prompt, resumeSessionId, setup }) {
    // The provider's bin is Node. Do not pass user --agent-args through as Node flags; the bridge
    // uses only its own fixed arguments and the worker's verified project directory.
    const args = [setup.bridge, '--cwd', cwd];
    if (resumeSessionId) args.push('--resume', resumeSessionId);
    if (prompt) args.push('--prompt', prompt);
    return { args, rotateToken: true };
  },
  hook: { strictJson: true, handle: openHandsHook },
  titleNoise: /^OpenHands( Agent Canvas)?$/i,
};
