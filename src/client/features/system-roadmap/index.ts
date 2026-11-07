import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';

declare module '../../world/types' {
  interface InteractKinds {
    systemroadmap: true;
    systemagent: true;
  }
}

export interface SystemRoadmapDeps {
  showRoadmap(): void;
  askRoadmap(): void;
}

export function installSystemRoadmap(ctx: Ctx, deps: SystemRoadmapDeps) {
  ctx.interactions.define('systemroadmap', {
    reach: 8,
    hint: () => ({ k: '', parts: [hintTitle('🗺️ System Roadmap'), aside('Read this project’s roadmap'), key('E', 'Open roadmap')] }),
    use: onE(() => deps.showRoadmap()),
  });
  ctx.interactions.define('systemagent', {
    reach: 5,
    hint: () => ({ k: '', parts: [hintTitle('🧭 System Agent'), aside('Ask me to explain this project’s roadmap'), key('E', 'Ask a question')] }),
    use: onE(() => deps.askRoadmap()),
  });
}
