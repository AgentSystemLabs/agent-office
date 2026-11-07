import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';

declare module '../../world/types' {
  interface InteractKinds {
    systemroadmap: true;
  }
}

export interface SystemRoadmapDeps {
  showRoadmap(): void;
}

export function installSystemRoadmap(ctx: Ctx, deps: SystemRoadmapDeps) {
  ctx.interactions.define('systemroadmap', {
    reach: 8,
    hint: () => ({ k: '', parts: [hintTitle('🗺️ System Roadmap'), aside('Read this project’s roadmap'), key('E', 'Open roadmap')] }),
    use: onE(() => deps.showRoadmap()),
  });
}
