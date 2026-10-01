import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LifecycleReport } from './workers/lifecycle.js';
import { shq } from './workers/process.js';

export const ANTIGRAVITY_HOOK_SCRIPT = `const http = require('http');
const [event] = process.argv.slice(2);
let size = 0;
let overflow = false;
const chunks = [];
const MAX = 1024 * 1024;

process.stdin.on('data', (c) => {
  if (overflow) return;
  size += c.length;
  if (size > MAX) { overflow = true; return; }
  chunks.push(c);
});

process.stdin.on('end', () => {
  if (event === 'PreToolUse') {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  } else {
    process.stdout.write('{}');
  }

  if (overflow) return;
  let raw = '';
  try {
    raw = Buffer.concat(chunks).toString('utf8');
  } catch {
    return;
  }

  const base = process.env.AGENT_OFFICE_HOOK_URL;
  const token = process.env.AGENT_OFFICE_HOOK_TOKEN;
  const worker = process.env.AGENT_OFFICE_WORKER_ID;
  if (!base || !token || !worker) return;

  try {
    const url = new URL('/hooks/antigravity', base);
    url.searchParams.set('worker', worker);
    url.searchParams.set('event', event);

    const req = http.request(
      url,
      {
        method: 'POST',
        timeout: 2000,
        headers: {
          authorization: 'Bearer ' + token,
          'content-type': 'application/json',
        },
      },
      (res) => res.resume()
    );
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.end(raw);
  } catch {}
});
`;

const MAX_ID = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function bounded(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text && text.length <= max ? text : undefined;
}

/** Formats arguments for launching the agy CLI. */
export function antigravityArgs(
  extra: string[],
  options: { model?: string; effort?: string; prompt?: string; resumeSessionId?: string } = {},
): string[] {
  const flags = new Set(['--continue', '-c']);
  const values = new Set(['--model', '--effort', '--conversation', '-i', '--prompt-interactive', '-p', '--print']);
  const args: string[] = [];

  for (let i = 0; i < extra.length; i++) {
    const arg = extra[i];
    if (flags.has(arg)) continue;
    if (values.has(arg)) {
      if (extra[i + 1] !== undefined && !extra[i + 1].startsWith('-')) i++;
      continue;
    }
    if ([...values].some((name) => arg.startsWith(`${name}=`))) continue;
    args.push(arg);
  }

  if (options.resumeSessionId) {
    args.push('--conversation', options.resumeSessionId);
  }
  if (options.model) {
    args.push('--model', options.model);
  }
  if (options.effort) {
    args.push('--effort', options.effort);
  }
  if (options.prompt) {
    args.push('-i', options.prompt);
  }

  return args;
}

/** Normalize Antigravity hooks.json lifecycle payload into an Agent Office LifecycleReport. */
export function normalizeAntigravityHook(event: string, payload: unknown): LifecycleReport | undefined {
  if (!isRecord(payload)) return undefined;
  const sessionId = bounded(payload.conversationId, MAX_ID);
  if (!sessionId) return undefined;

  switch (event) {
    case 'PreInvocation':
      return {
        sessionId,
        event: 'UserPromptSubmit',
      };
    case 'PreToolUse': {
      const toolCall = isRecord(payload.toolCall) ? payload.toolCall : undefined;
      const tool = toolCall ? bounded(toolCall.name, MAX_ID) : undefined;
      return {
        sessionId,
        event: 'PreToolUse',
        tool: tool ?? 'tool',
      };
    }
    case 'PostToolUse':
      return {
        sessionId,
        event: 'PostToolUse',
      };
    case 'Stop':
      return {
        sessionId,
        event: 'Stop',
      };
    default:
      return undefined;
  }
}

/** Writes the standalone bridge script to dataDir. */
export function writeAntigravityHookScript(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'agent-office-antigravity-hook.cjs');
  writeFileSync(file, ANTIGRAVITY_HOOK_SCRIPT, { mode: 0o700 });
  return file;
}

/** Constructs the hooks.json definition for Antigravity. */
export function antigravityHooksConfig(hookScriptPath: string): Record<string, unknown> {
  const isWin = process.platform === 'win32';
  const nodeBin = process.execPath;
  const cmd = (event: string) =>
    isWin
      ? `"${nodeBin}" "${hookScriptPath}" ${event}`
      : `${shq(nodeBin)} ${shq(hookScriptPath)} ${event}`;

  return {
    'agent-office-bridge': {
      PreToolUse: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: cmd('PreToolUse'), timeout: 5 }],
        },
      ],
      PostToolUse: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: cmd('PostToolUse'), timeout: 5 }],
        },
      ],
      PreInvocation: [
        {
          type: 'command',
          command: cmd('PreInvocation'),
          timeout: 5,
        },
      ],
      Stop: [
        {
          type: 'command',
          command: cmd('Stop'),
          timeout: 5,
        },
      ],
    },
  };
}

/** Configuration for the Summer Engine MCP server. */
export function summerEngineMcpConfig(): Record<string, unknown> {
  const isWin = process.platform === 'win32';
  return {
    command: isWin ? 'npx.cmd' : 'npx',
    args: ['-y', 'summer-engine@latest', 'mcp'],
  };
}

/** Configuration for the Agent Office MCP server. */
export function agentOfficeMcpConfig(mcpScript: string): Record<string, unknown> {
  return {
    command: process.execPath,
    args: [mcpScript, 'mcp'],
  };
}

export const SUMMER_ENGINE_RULES = `# Summer Engine & Game Studio Guidelines

This workspace is integrated with **Summer Engine** via MCP and configured for collaborative game development.

## 🛠️ Summer Engine Overview
Summer Engine connects your agent to a Godot-compatible game engine runtime. Use the \`summer_*\` tools to inspect, compose, script, and playtest games:
- **Project & Scenes**: \`summer_get_project_context\`, \`summer_get_scene_tree\`, \`summer_create_scene\`, \`summer_open_scene\`, \`summer_save_scene\`
- **Nodes & Properties**: \`summer_add_node\`, \`summer_set_prop\`, \`summer_connect_signal\`, \`summer_remove_node\`, \`summer_replace_node\`
- **Asset Generation & 2D/3D**:
  - \`summer_generate_image\` (textures, concept art, sprite sheets)
  - \`summer_slice_asset_sheet\` (slicing atlas textures into tiles/sprites)
  - \`summer_generate_3d\`, \`summer_fabricate_3d\` (3D models, meshes)
  - \`summer_generate_audio\` (sound effects, ambient sound, background music)
- **Code & Diagnostics**: \`summer_write_file\`, \`summer_replace_text\`, \`summer_read_file\`, \`summer_get_diagnostics\`, \`summer_get_console\`
- **Runtime & Playtesting**: \`summer_play\`, \`summer_stop\`, \`summer_screenshot\`, \`summer_get_runtime_tree\`, \`summer_game_input\`

## 👥 Studio Roles & Team Collaboration
When working in an Agent Office game studio team or meeting:

### 🎨 Art (Art Lead)
- Responsible for all visual and audio assets in \`res://assets/\` (\`sprites/\`, \`models/\`, \`audio/\`).
- Generate 2D pixel art, sprites, tilesets, textures with \`summer_generate_image\`.
- Slice sprite sheets using \`summer_slice_asset_sheet\`.
- Generate 3D meshes using \`summer_generate_3d\` / \`summer_fabricate_3d\`.
- Produce SFX and musical tracks with \`summer_generate_audio\`.

### 💻 Code (Gameplay Engineer)
- Responsible for GDScript logic in \`res://scripts/\`.
- Write clean, modular, typed GDScript for player controllers, game managers, scoring, physics interactions.
- Connect signals (\`summer_connect_signal\`) between buttons/areas and scripts.
- Check engine logs and compiler diagnostics with \`summer_get_diagnostics\` and \`summer_get_console\`.

### 🕹️ Design (Game Designer)
- Responsible for scene composition in \`res://scenes/\` and gameplay balance.
- Assemble nodes, collision shapes, tilemaps, lights, and camera framing (\`summer_add_node\`, \`summer_set_prop\`).
- Configure user input mappings (\`summer_input_map_bind\`).
- Launch runtime sessions (\`summer_play\`), simulate player inputs (\`summer_game_input\`), capture screenshots (\`summer_screenshot\`), and inspect runtime state (\`summer_get_runtime_tree\`).

### 🎬 Director (Lead / Producer)
- Plans the game scope, architecture, and feature backlog.
- Assigns responsibilities to Art, Code, and Design.
- Verifies integration across disciplines, tests the full game loop, and writes release documentation.

## 🤝 Office Coordination
Use \`office-workers list\` to check on teammates and other desks in the office.
`;

/** Sets up .agents/hooks.json, .agents/mcp_config.json, and .agents/rules in cwd and ensures .agents is git-ignored via .git/info/exclude. */
export function ensureAntigravityWorkspace(cwd: string, hookScriptPath: string, mcpScriptPath?: string): void {
  try {
    const agentsDir = path.join(cwd, '.agents');
    mkdirSync(agentsDir, { recursive: true, mode: 0o700 });

    // 1. Hooks configuration
    const hooksPath = path.join(agentsDir, 'hooks.json');
    let currentHooks: Record<string, unknown> = {};
    if (existsSync(hooksPath)) {
      try {
        currentHooks = JSON.parse(readFileSync(hooksPath, 'utf8'));
      } catch {}
    }
    const bridgeConfig = antigravityHooksConfig(hookScriptPath);
    Object.assign(currentHooks, bridgeConfig);
    writeFileSync(hooksPath, JSON.stringify(currentHooks, null, 2), { mode: 0o600 });

    // 2. MCP configuration (Summer Engine & Office Workers)
    const mcpConfigPath = path.join(agentsDir, 'mcp_config.json');
    let currentMcp: { mcpServers?: Record<string, unknown> } = {};
    if (existsSync(mcpConfigPath)) {
      try {
        currentMcp = JSON.parse(readFileSync(mcpConfigPath, 'utf8'));
      } catch {}
    }
    if (!currentMcp || typeof currentMcp !== 'object' || Array.isArray(currentMcp)) {
      currentMcp = {};
    }
    const servers =
      currentMcp.mcpServers && typeof currentMcp.mcpServers === 'object' && !Array.isArray(currentMcp.mcpServers)
        ? (currentMcp.mcpServers as Record<string, unknown>)
        : {};
    servers['summer-engine'] = summerEngineMcpConfig();
    if (mcpScriptPath) {
      servers['agent-office'] = agentOfficeMcpConfig(mcpScriptPath);
    }
    currentMcp.mcpServers = servers;
    writeFileSync(mcpConfigPath, JSON.stringify(currentMcp, null, 2), { mode: 0o600 });

    // 3. Studio rules & instructions
    const rulesDir = path.join(agentsDir, 'rules');
    mkdirSync(rulesDir, { recursive: true, mode: 0o700 });
    const rulesPath = path.join(rulesDir, 'summer_engine.md');
    writeFileSync(rulesPath, SUMMER_ENGINE_RULES, { mode: 0o600 });

    // 4. Git exclude for .agents/
    const gitExclude = path.join(cwd, '.git', 'info', 'exclude');
    if (existsSync(gitExclude)) {
      try {
        const content = readFileSync(gitExclude, 'utf8');
        if (!content.includes('.agents')) {
          writeFileSync(gitExclude, `${content.trimEnd()}\n.agents/\n`, 'utf8');
        }
      } catch {}
    }
  } catch {}
}
