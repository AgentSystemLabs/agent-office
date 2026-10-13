import type { Meeting } from './protocol.js';

export function meetingPresence(m: Meeting | null, replayTitle?: string): string {
  if (replayTitle) return `⏪ replaying meeting: ${replayTitle}`;
  if (!m) return '🏛️ preparing a council';
  if (m.status === 'running') return m.pattern === 'council' ? `🏛️ observing council: ${m.title}` : `🤝 observing meeting: ${m.title}`;
  return m.pattern === 'council' ? `📜 reading council decision: ${m.title}` : `📄 reading meeting result: ${m.title}`;
}
