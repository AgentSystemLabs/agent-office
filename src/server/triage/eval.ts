// How triage's answers compare with issues labelled by hand (scripts/triage-eval.ts): run it on
// shadow mode's results before turning auto-queue on.
import type { TriageAnswers } from '../../shared/protocol.js';

/** One issue as a person labelled it: any of these may be left out. */
export interface HandLabel {
  number: number;
  type?: string;
  size?: string;
  agentReady?: boolean;
}

export interface Agreement {
  /** Issues both labelled and classified. */
  compared: number;
  type: { right: number; of: number };
  size: { right: number; of: number };
  /** agent-ready: of those triage said yes to, how many were (precision); of those that were, how many it found (recall). */
  agentReady: { precision: number; recall: number; falseYes: number[] };
}

export function agreement(hand: HandLabel[], answers: Map<number, TriageAnswers>, threshold: number): Agreement {
  const out: Agreement = { compared: 0, type: { right: 0, of: 0 }, size: { right: 0, of: 0 }, agentReady: { precision: NaN, recall: NaN, falseYes: [] } };
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const h of hand) {
    const a = answers.get(h.number);
    if (!a) continue;
    out.compared++;
    if (h.type) {
      out.type.of++;
      if (a.type.value === h.type) out.type.right++;
    }
    if (h.size) {
      out.size.of++;
      if (a.size.value === h.size) out.size.right++;
    }
    if (h.agentReady !== undefined) {
      const said = a.agentReady.p >= threshold;
      if (said && h.agentReady) tp++;
      else if (said) (fp++, out.agentReady.falseYes.push(h.number));
      else if (h.agentReady) fn++;
    }
  }
  out.agentReady.precision = tp + fp ? tp / (tp + fp) : NaN;
  out.agentReady.recall = tp + fn ? tp / (tp + fn) : NaN;
  return out;
}
