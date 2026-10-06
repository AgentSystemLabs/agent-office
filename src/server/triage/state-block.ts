// What the classifier is told about an issue (Jev's `state`), and the seven questions it answers,
// in the shape of TypeSafe's API: https://docs.typesafe.ai/api
import type { TriageArea } from './config.js';

export interface ClassifyInput {
  /** owner/name */
  repo: string;
  description: string;
  areas: TriageArea[];
  /** The checkout's top-level folders, so an area has something concrete to match. */
  folders: string[];
  issue: { number: number; title: string; body: string; author: string; labels: string[] };
  /** The last few, oldest first. */
  comments: { author: string; body: string }[];
}

export type QuestionKey = 'type' | 'area' | 'agent_ready' | 'size' | 'priority' | 'needs_human' | 'cross_repo';

/** A yes/no question ("noul": the answer is the probability of yes), or one of a set of options. */
export type TriageQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> };

/** Comments sent along, at most. */
export const MAX_COMMENTS = 10;
/**
 * The state's length as JSON, at most: Jev takes 32k tokens for the state plus its longest question,
 * and code and logs run to fewer characters per token than prose.
 */
const MAX_STATE_CHARS = 60_000;
const MAX_BODY_CHARS = 20_000;
const MAX_COMMENT_CHARS = 3_000;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…(cut)` : s);

/** The repo and the issue as structured state: what the classifier decides from. */
export function stateBlock(i: ClassifyInput): Record<string, unknown> {
  const state: Record<string, unknown> = {
    repository: {
      name: i.repo,
      ...(i.description ? { description: i.description } : {}),
      ...(i.areas.length ? { areas: Object.fromEntries(i.areas.map((a) => [a.name, a.description])) } : {}),
      ...(i.folders.length ? { top_level_folders: i.folders } : {}),
    },
    issue: {
      number: i.issue.number,
      author: i.issue.author,
      title: i.issue.title,
      labels: i.issue.labels,
      body: clip(i.issue.body.trim() || '(no description)', MAX_BODY_CHARS),
    },
  };
  // Newest comments are kept first when they don't all fit.
  const comments: { author: string; body: string }[] = [];
  let room = MAX_STATE_CHARS - JSON.stringify(state).length;
  for (const c of i.comments.slice(-MAX_COMMENTS).reverse()) {
    const comment = { author: c.author, body: clip(c.body.trim(), MAX_COMMENT_CHARS) };
    const size = JSON.stringify(comment).length + 1;
    if (size > room) break;
    comments.unshift(comment);
    room -= size;
  }
  if (comments.length) state.comments = comments;
  return state;
}

export const TYPE_CRITERIA = {
  bug: 'Something that should work is broken or wrong',
  feature: 'A new capability or a change to how something works',
  docs: 'Documentation only: README, guides, code comments',
  chore: 'Maintenance with no change in behavior: dependencies, refactoring, CI, tooling',
  question: 'Someone asking how something works or for help, not asking for a change',
  'duplicate-or-spam': 'Repeats another issue, is empty, off-topic, or spam',
};

export const SIZE_CRITERIA = {
  xs: 'A line or two: a typo, a constant, a one-line fix',
  s: 'One small, contained change in one or two files',
  m: 'A change across a few files with some tests',
  l: 'A feature or fix that spans several parts of the codebase',
  xl: 'Too big for one pull request: should be split into smaller issues',
};

export const PRIORITY_CRITERIA = {
  p0: 'Broken for everyone right now, or a security or data-loss problem',
  p1: 'Important and should be done soon',
  p2: 'Normal priority',
  p3: 'Nice to have, whenever there is time',
};

/** The questions, keyed as TypeSafe's `questions` map; answers come back under the same keys. */
export function questions(areas: TriageArea[]): Partial<Record<QuestionKey, TriageQuestion>> {
  return {
    type: { type: 'choice', instructions: 'What kind of GitHub `issue` is this?', criteria: TYPE_CRITERIA },
    ...(areas.length
      ? { area: { type: 'choice' as const, instructions: 'Which of the `repository`\'s areas does the `issue` mostly concern?', criteria: Object.fromEntries(areas.map((a) => [a.name, a.description || null])) } }
      : {}),
    agent_ready: {
      type: 'noul',
      instructions: 'Could a coding agent do what the `issue` asks right now, without asking anyone anything?',
      criteria: {
        true: 'The goal is clear and there is enough detail (what should happen, where, or how to reproduce it) to make the change and open a pull request',
        false: 'The goal is vague, details are missing, or it needs a discussion or decision first',
      },
    },
    size: { type: 'choice', instructions: 'How big is the code change the `issue` needs?', criteria: SIZE_CRITERIA },
    priority: { type: 'choice', instructions: 'How urgent is the `issue`?', criteria: PRIORITY_CRITERIA },
    needs_human: {
      type: 'noul',
      instructions: 'Does the `issue` need a person rather than an automated agent?',
      criteria: {
        true: 'It touches secrets or credentials, billing or payments, deleting data, security, or needs a product decision',
        false: 'It is ordinary engineering work an agent may do and a reviewer can check',
      },
    },
    cross_repo: {
      type: 'noul',
      instructions: 'Does the `issue` likely need changes in another repository besides the `repository`?',
    },
  };
}
