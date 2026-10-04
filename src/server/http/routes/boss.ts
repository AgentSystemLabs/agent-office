// Boss Office Workstation routes: absolute command execution & inter-agent communication.
import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Route } from '../router.js';
import { readBody, send } from '../util.js';

const execAsync = promisify(exec);

export const bossRoutes = {
  /** POST /api/boss/command - Execute host commands with absolute permissions */
  command: {
    method: 'POST',
    path: '/api/boss/command',
    auth: 'public',
    async handle(ctx, { req, res }) {
      try {
        const raw = await readBody(req, 65536);
        const data = JSON.parse(raw) as { command?: string };
        const command = (data.command || '').trim();

        if (!command) {
          return send(res, 400, { error: 'Command string is required' });
        }

        const start = Date.now();
        const rootDir = ctx.cfg.dir;

        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: rootDir,
            maxBuffer: 10 * 1024 * 1024,
            timeout: 60000,
            env: { ...process.env, TERM: 'xterm-256color', PAGER: 'cat' }
          });

          const durationMs = Date.now() - start;
          return send(res, 200, {
            ok: true,
            command,
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            exitCode: 0,
            durationMs
          });
        } catch (execErr: any) {
          const durationMs = Date.now() - start;
          return send(res, 200, {
            ok: false,
            command,
            stdout: execErr.stdout ? execErr.stdout.toString() : '',
            stderr: execErr.stderr ? execErr.stderr.toString() : execErr.message,
            exitCode: execErr.code ?? 1,
            durationMs
          });
        }
      } catch (err: any) {
        return send(res, 500, { error: err.message });
      }
    }
  },

  /** POST /api/boss/talk - Send executive commands/directives to agents */
  talk: {
    method: 'POST',
    path: '/api/boss/talk',
    auth: 'public',
    async handle(ctx, { req, res }) {
      try {
        const raw = await readBody(req, 65536);
        const data = JSON.parse(raw) as {
          recipient?: string; // 'all' or workerId or deskId or name
          prompt?: string;
          message?: string;
          title?: string;
        };

        const promptText = (data.prompt || data.message || '').trim();
        if (!promptText) {
          return send(res, 400, { error: 'Prompt/command text is required' });
        }

        const recipient = data.recipient || 'all';
        const prompted: string[] = [];

        for (const floor of ctx.floors.values()) {
          const workers = floor.workers.list();
          for (const w of workers) {
            const matches =
              recipient === 'all' ||
              w.id === recipient ||
              w.name.toLowerCase() === recipient.toLowerCase() ||
              (w.deskId && w.deskId.toLowerCase() === recipient.toLowerCase());

            if (matches) {
              const fullPrompt = `👑 [FOUNDER / BOSS DIRECTIVE]: ${promptText}`;
              floor.workers.prompt(w.id, fullPrompt, 'Boss');
              prompted.push(`${w.name} (${w.deskId || w.id})`);
            }
          }
        }

        // Persist directive into ceo_pings.json
        const rootDir = ctx.cfg.dir;
        const pingsFile = path.join(rootDir, '.agent-office', 'ceo_pings.json');
        let pings: any[] = [];
        try {
          if (fs.existsSync(pingsFile)) {
            pings = JSON.parse(fs.readFileSync(pingsFile, 'utf8'));
          }
        } catch {}

        const newPing = {
          id: `directive-${Date.now()}`,
          from: 'Boss (Executive Office)',
          type: 'directive',
          title: data.title || promptText.slice(0, 48),
          content: promptText,
          recipient,
          prompted,
          createdAt: new Date().toISOString(),
          replies: []
        };

        pings.unshift(newPing);
        fs.mkdirSync(path.dirname(pingsFile), { recursive: true });
        fs.writeFileSync(pingsFile, JSON.stringify(pings.slice(0, 50), null, 2), 'utf8');

        return send(res, 200, {
          ok: true,
          recipient,
          promptedCount: prompted.length,
          prompted,
          message: prompted.length > 0
            ? `Directive delivered to: ${prompted.join(', ')}`
            : 'No matching active workers found to receive directive.'
        });
      } catch (err: any) {
        return send(res, 500, { error: err.message });
      }
    }
  },

  /** GET /api/boss/state - Live office state for the boss workstation */
  state: {
    method: 'GET',
    path: '/api/boss/state',
    auth: 'public',
    handle(ctx, { res }) {
      const rootDir = ctx.cfg.dir;

      // Scan workers
      const workers = Array.from(ctx.floors.values()).flatMap((f) =>
        f.workers.list().map((w) => ({
          id: w.id,
          name: w.name,
          deskId: w.deskId,
          status: w.status,
          color: w.color,
          provider: w.provider,
          task: w.task,
          activity: w.activity
        }))
      );

      // Budget state
      let budget = {
        cumulative_spend_usd: 0.0,
        total_budget_usd: 100.0,
        runway_usd: 100.0,
        operational_state: 'NORMAL'
      };
      const budgetFile = path.join(rootDir, '.agent-office', 'budget_guard_state.json');
      try {
        if (fs.existsSync(budgetFile)) {
          budget = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
        }
      } catch {}

      // Pings / communications history
      let pings: any[] = [];
      const pingsFile = path.join(rootDir, '.agent-office', 'ceo_pings.json');
      try {
        if (fs.existsSync(pingsFile)) {
          pings = JSON.parse(fs.readFileSync(pingsFile, 'utf8'));
        }
      } catch {}

      return send(res, 200, {
        ok: true,
        workers,
        budget,
        pings: pings.slice(0, 20),
        timestamp: new Date().toISOString()
      });
    }
  }
} satisfies Record<string, Route>;
