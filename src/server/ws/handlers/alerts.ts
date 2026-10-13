import type { AlertState } from '../../../shared/protocol.js';
import type { Floor } from '../../floor.js';
import type { Ctx } from '../../office/context.js';

export function alertsView(_ctx: Ctx, floor: Floor | undefined): AlertState {
  return floor?.alerts.state() ?? { cards: [] };
}
