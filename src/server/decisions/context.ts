import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { Decisions } from './store.js';
export const floorDecisions = (ctx: Ctx, floor: Floor) => new Decisions(ctx.cfg.dataDir, floor.def.repo ?? floor.id);
