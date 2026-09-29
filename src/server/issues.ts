// Where a floor's 📌 issues come from. GitHub, through the gh CLI (github.ts), or Linear, through its
// API with the office's key (linear.ts, linear-key.ts). Pull requests always come from GitHub; only the
// issue board, the cards, the queue's links and the prompts change with the provider.

import type { GhCloseReason, GhComment, GhIssue, GhIssueDetail, GhLabel, GhState } from '../shared/protocol.js';

export type IssueProviderKind = 'github' | 'linear';

/** Which tracker the office's issue boards read, the same on every floor. */
export type IssuesConfig =
  | { provider: 'github' }
  | {
      provider: 'linear';
      /** Team keys (FOUND, PLAT) whose issues fill the board. The API key is kept apart, in linear-key.ts. */
      teams: string[];
    };

/** One floor's issue board and everything the office does to an issue. Ids are as in shared/issues.ts. */
export interface IssueProvider {
  readonly kind: IssueProviderKind;
  readonly issues: GhState<GhIssue>;
  /** Asks the tracker for the board again. Resolves once the state (fresh or with an error) went out. */
  refreshIssues(): Promise<void>;
  issueDetail(id: string): Promise<GhIssueDetail>;
  comment(kind: 'issue', id: string, body: string): Promise<{ comment?: GhComment; error?: string }>;
  close(kind: 'issue', id: string, opts: { comment?: string; reason?: GhCloseReason }): Promise<string | undefined>;
  /** Takes the issue on as the office's own account, which moves it to In progress on the board. Resolves to an error message when it can't. */
  claim(id: string): Promise<string | undefined>;
  /** Every label the tracker offers, for the label picker. */
  repoLabels(): Promise<GhLabel[]>;
  setLabels(kind: 'issue', id: string, add: string[], remove: string[]): Promise<{ labels?: GhLabel[]; error?: string }>;
}
