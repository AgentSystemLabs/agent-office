/** The 📈 market terminal: J opens it (as does "Market terminal" in the Ctrl+K palette). */
import type { Ctx } from '../../core/context';
import { openMarket } from './ui';

export { openMarket };

export function installMarket(ctx: Ctx) {
  ctx.keys.bind({ code: 'KeyJ', preventDefault: true, run: openMarket });
}
