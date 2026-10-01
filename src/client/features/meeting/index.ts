/** The meeting room: E there (or 🤝 in the menu) opens its window, how the meeting's going or the form to call one. */
import { MEETING_PATTERNS, meetingStage } from '../../../shared/meetings';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import { clip } from '../../ui/dom';
import { openMeeting, type MeetingPreset } from '../../ui/meeting';
import { L } from '../../i18n';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    meeting: true;
  }
}

export function installMeeting(ctx: Ctx, parts: Pick<Parts, 'waiting' | 'actions'>) {
  /** The meeting room's window: how the meeting's going, or the form to call one (prefilled from an issue or a PR). */
  function showMeeting(preset?: MeetingPreset) {
    openMeeting(
      ctx.net,
      {
        openTerminal: (id) => parts.waiting.openWorkerTerminal(id),
        openPr: (id) => {
          const w = store.workers.get(id);
          if (w) parts.actions.pullRequestFor(w);
        },
      },
      preset,
    );
  }

  ctx.interactions.define('meeting', {
    reach: 7,
    hint: () => {
      const m = store.meeting.current;
      const p = m && MEETING_PATTERNS[m.pattern];
      const what = !m || !p ? L.hints.free : m.status === 'running' ? `${p.icon} ${p.label} · ${meetingStage(m)}` : `${p.icon} ${p.label} ${m.status === 'done' ? L.hints.meetingDone : L.hints.meetingStopped}`;
      return { k: what, parts: [hintTitle(L.hints.meetingRoom), aside(clip(what, 50)), key('E', m?.status === 'running' ? L.hints.seeHow : m ? L.hints.seeOrCall : L.hints.callMeeting)] };
    },
    use: onE(() => showMeeting()),
  });

  return { showMeeting };
}
