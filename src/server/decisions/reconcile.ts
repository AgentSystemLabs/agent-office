import type { Ctx } from '../office/context.js';
import { floorDecisions } from './context.js';

const POLL_MS = 30_000;
function promptFor(repo: string, d: ReturnType<ReturnType<typeof floorDecisions>['claim']>) {
  const f = d.followup!;
  const marker = `office-decision:${d.id}:${f.answerAt}`;
  return `Abgleich einer bereits vom Menschen beantworteten Entscheidung im Repository ${repo}.
Entscheidung ${d.id}; Antwortversion ${f.answerAt}; Abgleich-ID ${f.dispatchId}; Idempotenzmarker ${marker}.
Frage: ${d.question}
Antwort des Menschen: ${d.answer}
Kontext: ${d.context.slice(0, 3500)}
Ursprüngliche Issues: ${d.issues.map(n => '#' + n).join(', ') || 'keine'}.
Vorheriger Abgleich: ${f.status}; Issues ${f.issueNumbers.map(n => '#' + n).join(', ') || 'keine'}; ${f.note.slice(0, 1000)}.

Prüfe Antwort, aktuellen Code, verlinkte offene und geschlossene Issues und gemergte/offene PRs. Ein geschlossenes Ursprungs-Issue beweist nicht, dass eine spätere Entscheidung umgesetzt wurde. Suche vor jeder Anlage nach semantischen Duplikaten und nach dem Marker. Wenn Arbeit fehlt, ergänze ein passendes offenes Issue oder erstelle ein verlinktes Folge-Issue mit dem Marker im Body. Bei einem bereits gemergten Ursprungs-Issue das neue Arbeitspaket nicht stillschweigend als erledigt markieren. Schreibe die Entscheidung und ihre Antwort nachvollziehbar ins Issue und verlinke die Quellen. Kein Issue in die Office-Queue stellen, keinem Worker zuweisen oder starten; nur der Mensch entscheidet darüber. Keine manuelle Prüfung als bestanden markieren.

Melde den Abschluss zwingend mit office-decisions report und JSON auf stdin:
{"id":"${d.id}","answerAt":${f.answerAt},"dispatchId":"${f.dispatchId}","status":"issue_linked|merged|no_action|needs_clarification","issueNumbers":[123],"evidence":"PR-/Commit-Link bei merged, sonst optional","note":"konkreter Abgleich und Begründung"}
issue_linked braucht mindestens eine Issue-Nummer. merged braucht einen konkreten Merge-Nachweis und bedeutet noch nicht menschlich verifiziert. no_action braucht eine belegte Begründung. Bei Unsicherheit needs_clarification. Der Abgleich bleibt offen und wird erneut versucht, wenn du nicht berichtest. Verwende dieselbe Antwortversion und denselben Marker bei Wiederholung. Keine Queue-Änderung.`;
}

/** Dispatches durable decision audits to the issue station, never to the task queue. */
export function startDecisionReconciler(ctx: Ctx): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    try {
      for (const floor of ctx.floors.values()) {
        const current = floor.workers.list().find(w => w.deskId === 'station-issues');
        if (current && (current.status === 'working' || current.status === 'needs_input')) continue;
        const pool = floorDecisions(ctx, floor), due = pool.due();
        if (!due?.followup) continue;
        let claimed;
        try { claimed = pool.claim(due.id, due.followup.answerAt); }
        catch { continue; }
        try {
          const result = floor.workers.station('station-issues', claimed.answeredBy ?? 'Office', promptFor(floor.def.repo ?? floor.id, claimed), claimed.owner);
          if (typeof result === 'string') pool.dispatchFailed(claimed.id, claimed.followup!.answerAt, result);
          else pool.dispatched(claimed.id, claimed.followup!.answerAt, result.info.id);
        } catch (e) { pool.dispatchFailed(claimed.id, claimed.followup!.answerAt, (e as Error).message); }
      }
    } catch (e) { console.error('decision reconciliation failed:', e); }
    finally { running = false; }
  };
  const first = setTimeout(tick, 5000), timer = setInterval(tick, POLL_MS);
  return () => { clearTimeout(first); clearInterval(timer); };
}
