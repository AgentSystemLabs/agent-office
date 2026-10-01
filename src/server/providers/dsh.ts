// DeepSeek Harness: no terminal and no hooks. The office holds an ACP connection to it and draws
// its updates into the worker's terminal itself (see ../dsh.ts and docs/dsh-acp-integration.md).
import { dshArgs, writeDshPatch } from '../dsh.js';
import type { ProviderAdapter } from './types.js';

interface DshSetup {
  dataDir: string;
  profile: string;
}

export const dsh: ProviderAdapter<undefined, DshSetup> = {
  id: 'dsh',
  prepare: ({ dataDir, dshProfile }) => ({ dataDir, profile: dshProfile }),
  // No argv for prompts or resume: those go over ACP.
  launch: ({ args, setup }) => ({
    args: dshArgs({ profile: setup.profile, patches: [writeDshPatch(setup.dataDir)], extra: args }),
    env: { AGENT_OFFICE_DSH_PROFILE: setup.profile },
  }),
  transport: 'acp',
  usage: { persisted: true },
};
