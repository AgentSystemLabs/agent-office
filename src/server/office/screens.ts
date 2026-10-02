import type { Floor } from '../floor.js';
import type { Ctx } from './context.js';
import type { Client } from './client.js';

export const screensOf = (ctx: Ctx, c: Client, floor: Floor | undefined) => {
  if (!c.screens || c.peer.lite) return;
  for (const { workerId, frame } of floor?.workers.fullScreens() ?? []) ctx.sendTo(c, { t: 'screen', workerId, ...frame, full: true });
};
