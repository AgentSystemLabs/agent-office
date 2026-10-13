// LokiDewa research feed: turns the whale research report into WHY NOW alert cards.
// Read-only: it parses text the report already produced. It never reads the DB, never sends
// Telegram, and never turns an INSUFFICIENT verdict into a recommendation.
import { readFileSync } from 'node:fs';
import type { AlertInput } from '../shared/protocol/alerts.js';

const REPORT = /<b>LAPORAN RISET WHALE<\/b> — (\d{4}-\d{2}-\d{2}) \d{2}:\d{2} UTC/;
const ENTITY = /^• (\S{6,}): n=(\d+) \((\d+) token\), median net ([+-][\d.]+)%.*?(?:— (FOLLOW_ELIGIBILITY_REVIEW|NOT_DISTINGUISHABLE_FROM_BASELINE|INSUFFICIENT))?\s*$/;
// The protocol has no SUPPORTED verdict; anything claiming it is not this report.
const BANNED = /SUPPORTED|probabilitas|menang minimal \d+% win/i;

/** Research cards for the alert board, or [] when the report is missing or makes claims it must not. */
export function researchCards(text: string): AlertInput[] {
  const head = REPORT.exec(text);
  if (!head) return [];
  const freshness = head[1];
  if (BANNED.test(text)) return [];
  const cards: AlertInput[] = [];
  for (const line of text.split('\n')) {
    const m = ENTITY.exec(line);
    if (!m) continue;
    const [, wallet, n, tokens, median, verdict = 'INSUFFICIENT'] = m;
    cards.push({
      kind: 'insider',
      severity: 'info',
      title: `${wallet}: median net ${median}%`,
      token: wallet,
      whyNow: `Shortlist entity moved: median net ${median}% over ${n} observations on ${tokens} token(s).`,
      evidence: [`n=${n} (${tokens} token)`, `median net ${median}%`],
      freshness,
      coverage: `n=${n} follower outcomes`,
      // A verdict other than FOLLOW_ELIGIBILITY_REVIEW is evidence of nothing yet.
      invalidation: `Evidence state: ${verdict}. Not a recommendation.`,
      links: [],
    });
  }
  return cards;
}

/**
 * Reads `reportPath` and adds its cards to the floor's board. Returns how many it added.
 * Missing or unreadable report: nothing changes, and the board keeps what it had.
 */
export function loadResearchAlerts(board: { add(input: AlertInput): unknown }, reportPath: string): number {
  let text: string;
  try {
    text = readFileSync(reportPath, 'utf8');
  } catch {
    return 0;
  }
  const cards = researchCards(text);
  for (const card of cards) board.add(card);
  return cards.length;
}
