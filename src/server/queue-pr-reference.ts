import type { GhPull } from '../shared/protocol.js';

/** An explicit task reference can link a partial/draft PR without promising to close its issue. */
export function referencesQueueIssue(pull: Pick<GhPull, 'closes' | 'body'>, issue: number): boolean {
  if (pull.closes.includes(issue)) return true;
  return [...pull.body.matchAll(/^[\t ]*(?:[-*][\t ]+)?(?:Refs|References)[\t ]+#(\d+)[\t ]*(?:[.!]|\([^\r\n]*\)[.!]?|[–—:][^\r\n]*)?[\t ]*$/gim)]
    .some((match) => Number(match[1]) === issue);
}
