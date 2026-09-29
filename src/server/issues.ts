// Where a floor's 📌 issues come from. GitHub, through the gh CLI (github.ts), or Linear, through a
// headless Claude session and the user's Linear connector (linear.ts). Pull requests always come from
// GitHub; only the issue board, the cards, the queue's links and the prompts change with the provider.

import type { GhCloseReason, GhComment, GhIssue, GhIssueDetail, GhLabel, GhState } from '../shared/protocol.js';

export type IssueProviderKind = 'github' | 'linear';

/** Which tracker the office's issue boards read, the same on every floor. */
export type IssuesConfig =
  | { provider: 'github' }
  | {
      provider: 'linear';
      /** Team keys or names whose issues fill the board. */
      teams: string[];
      /** A plain-English narrowing added to every refresh, e.g. "only issues assigned to me or unassigned". */
      filter?: string;
      /** The MCP server the Linear tools come from, as Claude names it: mcp__<server>__list_issues. */
      mcp: string;
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
