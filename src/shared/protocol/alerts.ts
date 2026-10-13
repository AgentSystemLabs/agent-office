export type AlertKind = 'accumulation' | 'convergence' | 'insider' | 'entry-watch';
export type AlertTopic = 'general' | 'convergence' | 'insider' | 'entry-watch';
export type AlertSeverity = 'info' | 'watch' | 'urgent';

export interface AlertInput {
  kind: AlertKind;
  title: string;
  token?: string;
  chain?: string;
  severity: AlertSeverity;
  whyNow: string;
  evidence: string[];
  freshness: string;
  coverage: string;
  invalidation: string;
  links?: { label: string; url: string }[];
}

export interface AlertCard {
  id: string;
  kind: AlertKind;
  topic: AlertTopic;
  title: string;
  token?: string;
  chain?: string;
  severity: AlertSeverity;
  createdAt: number;
  layers: {
    whyNow: string;
    evidence: string[];
    freshness: string;
    coverage: string;
    invalidation: string;
  };
  links: { label: string; url: string }[];
}

export interface AlertState {
  cards: AlertCard[];
}

export type AlertServerMsg = { t: 'alerts'; state: AlertState } | { t: 'alert.added'; card: AlertCard };
