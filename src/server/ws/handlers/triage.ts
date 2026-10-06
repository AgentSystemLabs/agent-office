// Issue triage on the floor's Issues board: Re-classify and Queue anyway (see server/triage/).
import type { TriageClientMsg } from '../../../shared/protocol.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';

const OFF = { enabled: false, results: [], stats: { day: '', triaged: 0, queued: 0, cap: 0, spend: 0 } };

export const triageView: ViewPieces['triage'] = (_ctx, floor) => floor?.triage.state() ?? OFF;

const issueNumber = (n: unknown) => (Number.isInteger(n) && (n as number) > 0 ? (n as number) : undefined);

export const triageHandlers = {
  'triage.reclassify'(ctx, c, msg) {
    const floor = here(ctx, c);
    const n = issueNumber(msg.number);
    if (!floor || n === undefined) return;
    const err = floor.triage.reclassify(n);
    if (err) ctx.warn(c, err);
  },
  'triage.queueAnyway'(ctx, c, msg) {
    const floor = here(ctx, c);
    const n = issueNumber(msg.number);
    if (!floor || n === undefined) return;
    const err = floor.triage.queueAnyway(n);
    if (err) ctx.warn(c, err);
    else ctx.toastFloor(floor, `📋 ${c.peer.name} queued issue #${n} past triage`);
  },
} satisfies HandlerMap<TriageClientMsg>;
