export const DECISION_CATEGORIES = ['Spielablauf', 'Design & UX', 'Technik', 'Assets', 'Release', 'Organisation', 'Sonstiges'] as const;
export interface DecisionInput {
  title: string;
  question: string;
  context: string;
  options: string[];
  recommendation: string;
  category: string;
  tags: string[];
  issues: number[];
  blocking: boolean;
  blockingReason: string;
}
export interface Decision extends DecisionInput {
  id: string; revision: number; status: 'open' | 'answered';
  createdAt: number; updatedAt: number; createdBy: string; owner?: string;
  workers: { id: string; name: string }[];
  answer?: string; answeredBy?: string; answeredAt?: number;
  history: { answer: string; by: string; at: number }[];
  notified?: Record<string, number>;
}
export interface DecisionView extends Decision { canAnswer: boolean }
export interface DecisionState { items: DecisionView[]; repo?: string }
export const blockedDecision = (d: Decision) => d.status === 'open' && d.blocking;
export function orderDecisions<T extends Decision>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Number(blockedDecision(b)) - Number(blockedDecision(a)) ||
    Number(a.status === 'answered') - Number(b.status === 'answered') || a.category.localeCompare(b.category, 'de') || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
