// The LokiDewa council's parts of each round, kept out of meetings.ts so the room's
// own file stays under its size ceiling (see tests/size.test.ts). The room calls this
// with its `say`, so the prompts stay rewritable in ⚙️ Settings like every other.
import path from 'node:path';
import { slugify } from '../shared/meetings.js';
import type { Meeting } from '../shared/protocol.js';
import type { PromptId, PromptVars } from '../shared/prompts.js';

/** One councillor's part of a step, the same shape the room's own plan returns. */
export interface CouncilPart {
  seat: number;
  doing: string;
  file: string;
  ask: string;
}

/**
 * The council's rounds: councillors brief from their mandates, challenge each other, and
 * the chair writes the decision LokiDewa acts on. Returns null when that step has no parts,
 * as the room's own plan does.
 */
export function councilParts(
  m: Meeting,
  round: number,
  step: number,
  cwd: string,
  notes: string,
  say: (id: PromptId, vars?: PromptVars) => string,
): CouncilPart[] | null {
  if (step > 1) return null;
  const all = m.seats.map((_, i) => i);
  const council = all.slice(1);
  // Notes are relative to the meeting's own folder; the prompts want full paths.
  const A = (rel: string) => path.join(cwd, rel);
  const note = (r: number, i: number) => `${notes}/r${r}-${i + 1}-${slugify(m.seats[i].role, 24)}.md`;
  const notes_ = (r: number, seats: number[]) => seats.map((i) => A(note(r, i))).join(', ');
  const last = round >= m.rounds || m.lastRound === round;

  // The last round is the chair's alone: the decision, and nothing beside it.
  if (last) {
    return [
      {
        seat: 0,
        doing: 'writing the decision',
        file: m.output,
        ask: say('meeting.council.decide', { title: m.title, briefings: notes_(round - 1, all), notes: A(notes), output: A(m.output) }),
      },
    ];
  }

  // Round 1: each councillor briefs from their own mandate.
  if (round === 1) {
    return council.map((i) => ({
      seat: i,
      doing: 'briefing their mandate',
      file: note(1, i),
      ask: say('meeting.council.brief', { role: m.seats[i].role, question: m.prompt, file: A(note(1, i)) }),
    }));
  }

  // A middle round: every councillor challenges the others, and the chair weighs them last.
  return all.map((i) => ({
    seat: i,
    doing: 'challenging',
    file: note(round, i),
    ask:
      i === 0
        ? say('meeting.council.weigh', { role: m.seats[0].role, briefings: notes_(round - 1, council), challenges: notes_(round - 1, council), file: A(note(round, i)) })
        : say('meeting.council.challenge', { role: m.seats[i].role, otherBriefings: notes_(round - 1, council.filter((j) => j !== i)), file: A(note(round, i)) }),
  }));
}
