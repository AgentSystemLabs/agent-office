// The classifier behind triage: TypeSafe Jev, or a stub for tests. Anything that answers the seven
// questions (state-block.ts) with probabilities can stand in, a Claude Haiku fallback included.
import { TRIAGE_PRIORITIES, TRIAGE_SIZES, TRIAGE_TYPES, type TriageAnswers, type TriageChoice } from '../../shared/protocol.js';
import { questions, stateBlock, type ClassifyInput, type QuestionKey } from './state-block.js';

export interface Classification {
  answers: TriageAnswers;
  /** What the call cost in US dollars, if the classifier says. */
  cost?: number;
}

export interface Classifier {
  readonly name: string;
  classify(input: ClassifyInput, signal?: AbortSignal): Promise<Classification>;
}

/** One question's answer as a classifier gives it: an option and its probability, or yes/no's probability of yes. */
export type RawAnswer = { value: string; p: number } | { p: number };
export type RawAnswers = Partial<Record<QuestionKey, RawAnswer>>;

const clamp = (p: unknown) => (typeof p === 'number' && Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : NaN);

function pick<T extends string>(raw: RawAnswer | undefined, options: readonly T[], key: string): TriageChoice<T> {
  const value = raw && 'value' in raw ? raw.value : undefined;
  const p = clamp(raw?.p);
  if (!options.includes(value as T) || Number.isNaN(p)) throw new Error(`classifier gave no usable answer for ${key}`);
  return { value: value as T, p };
}

function yes(raw: RawAnswer | undefined, key: string) {
  const p = clamp(raw?.p);
  if (Number.isNaN(p)) throw new Error(`classifier gave no usable answer for ${key}`);
  return { p };
}

/** Checks a classifier's answers against the questions it was asked. */
export function toAnswers(raw: RawAnswers, areas: string[]): TriageAnswers {
  return {
    type: pick(raw.type, TRIAGE_TYPES, 'type'),
    // A floor with no areas isn't asked; one it was asked about must be one of them.
    area: areas.length ? pick(raw.area, areas, 'area') : { value: '', p: 1 },
    agentReady: yes(raw.agent_ready, 'agent_ready'),
    size: pick(raw.size, TRIAGE_SIZES, 'size'),
    priority: pick(raw.priority, TRIAGE_PRIORITIES, 'priority'),
    needsHuman: yes(raw.needs_human, 'needs_human'),
    crossRepo: yes(raw.cross_repo, 'cross_repo'),
  };
}

/** Gives the same answers to everything, or whatever `fn` says: for tests and for trying the pipeline without a key. */
export class StubClassifier implements Classifier {
  readonly name = 'stub';
  calls: ClassifyInput[] = [];
  constructor(private fn: (input: ClassifyInput) => RawAnswers | Promise<RawAnswers>) {}
  async classify(input: ClassifyInput): Promise<Classification> {
    this.calls.push(input);
    return { answers: toAnswers(await this.fn(input), input.areas.map((a) => a.name)) };
  }
}

export interface JevOptions {
  apiKey: string;
  /** TypeSafe's evaluation endpoint. */
  url?: string;
  /** jev-latest, or a version like jev-1.13.0 to keep thresholds tuned against it. */
  model?: string;
  /** US dollars per million input tokens (output tokens are free). */
  pricePerMtok?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-latest';
/** Jev 1.13's price, per million input tokens (https://docs.typesafe.ai/models). */
export const JEV_PRICE_PER_MTOK = 0.042;

/**
 * TypeSafe Jev: the issue as `state` and the seven questions in one call, an answer with its
 * probability back for each (https://docs.typesafe.ai/api).
 */
export class JevClassifier implements Classifier {
  readonly name = 'jev';
  constructor(private o: JevOptions) {}

  async classify(input: ClassifyInput, signal?: AbortSignal): Promise<Classification> {
    const body = JSON.stringify({ model: this.o.model ?? JEV_MODEL, state: stateBlock(input), questions: questions(input.areas) });
    let last: Error | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      if (signal?.aborted) throw new Error('triage stopped');
      const timeout = AbortSignal.timeout(this.o.timeoutMs ?? 60_000);
      let res: Response;
      try {
        res = await (this.o.fetch ?? fetch)(this.o.url ?? JEV_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.o.apiKey}`, 'content-type': 'application/json' },
          body,
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        last = err as Error;
        continue;
      }
      // Rate limited (429), overloaded (529) or the server's own trouble: worth another go. The rest aren't.
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`Jev answered ${res.status}`);
        continue;
      }
      if (res.status === 401) throw new Error('Jev turned the API key down (401): check JEV_API_KEY');
      if (!res.ok) throw new Error(`Jev answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = await res.json();
      const tokens = typeof json?.usage?.input_tokens === 'number' ? json.usage.input_tokens : undefined;
      return {
        answers: toAnswers(jevAnswers(json), input.areas.map((a) => a.name)),
        cost: tokens === undefined ? undefined : (tokens / 1e6) * (this.o.pricePerMtok ?? JEV_PRICE_PER_MTOK),
      };
    }
    throw last ?? new Error('Jev failed');
  }
}

/**
 * The answers in a response, by question key: a choice's option with that option's probability,
 * a noul's probability of yes.
 */
export function jevAnswers(res: any): RawAnswers {
  const answers: RawAnswers = {};
  for (const [key, a] of Object.entries<any>(res?.answers ?? {})) {
    if (a?.type === 'noul') answers[key as QuestionKey] = { p: a.noul };
    else if (a?.type === 'choice') answers[key as QuestionKey] = { value: String(a.choice), p: a.probabilities?.[a.choice] };
  }
  return answers;
}
