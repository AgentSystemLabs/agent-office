// The GitHub windows behind the board cards (a PR, an issue, the label picker) live in github/; this
// is where the rest of the client finds them.
export { routePullMessage } from './github/api';
export { openIssue } from './github/issue-window';
export { labelChip, openLabels } from './github/labels';
export { openPull } from './github/pull-window';
