import type { AlertCard, AlertInput, AlertState, AlertTopic } from '../shared/protocol/alerts.js';

export type { AlertCard, AlertInput, AlertState } from '../shared/protocol/alerts.js';

export function topicForAlert(input: Pick<AlertInput, 'kind'>): AlertTopic {
  if (input.kind === 'accumulation') return 'general';
  return input.kind;
}

export class AlertBoard {
  private cards: AlertCard[] = [];

  constructor(private readonly limit = 100) {}

  state(): AlertState {
    return { cards: this.cards.map((c) => ({ ...c, layers: { ...c.layers }, links: c.links.map((l) => ({ ...l })) })) };
  }

  add(input: AlertInput, now = Date.now()): AlertCard {
    const card: AlertCard = {
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      kind: input.kind,
      topic: topicForAlert(input),
      title: input.title,
      token: input.token,
      chain: input.chain,
      severity: input.severity,
      createdAt: now,
      layers: {
        whyNow: input.whyNow,
        evidence: input.evidence.slice(),
        freshness: input.freshness,
        coverage: input.coverage,
        invalidation: input.invalidation,
      },
      links: input.links?.map((l) => ({ ...l })) ?? [],
    };
    this.cards.unshift(card);
    this.cards.length = Math.min(this.cards.length, this.limit);
    return card;
  }
}
