import type { Route } from '../router.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';
import { floorDecisions } from '../../decisions/context.js';
import { canAnswer, DecisionError, input, type Actor } from '../../decisions/store.js';
import { DECISION_SCAN } from '../../../shared/decision-prompts.js';
export const decisionsRoute: Route = {
  path: '/api/decisions', auth: 'session',
  async handle(ctx, { req, res, url, session }) {
    const floor = floorParam(ctx, url); if (!floor) return send(res, 404, { error: 'Projekt nicht gefunden.' });
    const actor: Actor = { name: session.account?.name ?? 'Office', owner: session.account?.id, admin: !session.account || session.account.role === 'admin' };
    try {
      const pool = floorDecisions(ctx, floor);
      if (req.method === 'GET') return send(res, 200, { repo: floor.def.repo, items: pool.list().map(d => ({ ...d, canAnswer: !!canAnswer(d, actor) })) });
      if (req.method !== 'POST') return send(res, 405, { error: 'GET oder POST verwenden.' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Im Office anmelden und dort antworten.' });
      const b = JSON.parse(await readBody(req, 24000));
      if (!b || typeof b !== 'object' || Array.isArray(b)) throw new DecisionError('Ungültige Anfrage.');
      if (b.action === 'scan') {
        const station = floor.workers.list().find(w => w.deskId === 'station-issues');
        if (actor.owner && ctx.claudeFor(station?.provider ?? floor.workers.officeDefault.provider) && !ctx.signins.claudeReady(actor.owner)) {
          await ctx.signins.look(actor.owner, true);
          if (!ctx.signins.claudeReady(actor.owner)) throw new DecisionError('Bitte zuerst beim Anbieter des Issue Agents anmelden.', 403);
        }
        const result = floor.workers.station('station-issues', actor.name, DECISION_SCAN, actor.owner);
        if (typeof result === 'string') throw new DecisionError(result, 409);
        return send(res, 202, { sent: true });
      }
      let item;
      if (b.action === 'add') item = pool.add(b.input, actor);
      else if (b.action === 'answer') item = pool.answer(b.id, b.revision, b.answer, actor);
      else if (b.action === 'edit') { const value = input(b.input); item = pool.change(b.id, b.revision, actor, d => {
        if (d.question !== value.question || JSON.stringify(d.options) !== JSON.stringify(value.options) || JSON.stringify(d.issues) !== JSON.stringify(value.issues)) { d.status = 'open'; d.notified = {}; }
        Object.assign(d, value);
      }); }
      else if (b.action === 'reopen') item = pool.change(b.id, b.revision, actor, d => { d.status = 'open'; });
      else if (b.action === 'notify') item = pool.change(b.id, b.revision, actor, d => {
        if (d.status !== 'answered' || !d.answer) throw new DecisionError('Zuerst eine Entscheidung speichern.');
        if (!d.workers.some(w => w.id === b.worker)) throw new DecisionError('Worker gehört nicht zu dieser Frage.', 403);
        if (d.notified?.[b.worker] === d.answeredAt) return;
        const worker = floor.workers.get(b.worker);
        if (!worker || worker.kind !== 'agent') throw new DecisionError('Worker ist nicht mehr vorhanden. Die Antwort bleibt im Pool.', 409);
        if (worker.status === 'working' || worker.status === 'needs_input') throw new DecisionError('Worker ist beschäftigt oder wartet im Terminal. Antwort wurde gespeichert; später erneut senden.', 409);
        const prompt = `Der Mensch ${actor.name} hat Entscheidung ${d.id} beantwortet.\nFrage: ${d.question}\nAntwort: ${d.answer}\nIssues: ${d.issues.map(n => '#' + n).join(', ')}\nPrüfe office-decisions list auf weitere offene Blockaden. Setze nur deine bereits beauftragte, von dieser Antwort betroffene Arbeit fort. Keine neuen Queue-Einträge und keine anderen Tasks starten.`;
        let error = floor.workers.prompt(worker.id, prompt, actor.name);
        if (error === 'Worker is not running') error = floor.workers.resume(worker.id, prompt);
        if (error) throw new DecisionError(error, 409);
        (d.notified ??= {})[worker.id] = d.answeredAt!;
      });
      else throw new DecisionError('Unbekannte Aktion.');
      return send(res, 200, { item });
    } catch (e) { return send(res, e instanceof DecisionError ? e.status : e instanceof SyntaxError ? 400 : 500, { error: e instanceof DecisionError ? e.message : 'Entscheidung konnte nicht verarbeitet werden.' }); }
  },
};
