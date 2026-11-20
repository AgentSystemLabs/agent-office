import type { ProviderAdapter } from './types.js';

interface DeepaiSetup { dataDir: string }

/** DeepAI Code runs each worker as an app-owned thread, rendered by the office. */
export const deepai: ProviderAdapter<undefined, DeepaiSetup> = {
  id: 'deepai',
  transport: 'thread',
  prepare: ({ dataDir }) => ({ dataDir }),
  launch: () => ({ args: [] }),
  usage: { persisted: true },
};
