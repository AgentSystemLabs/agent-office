// A floor's Jira epic as a read-only kanban board (see server/jira.ts): the shapes the office and
// the browser share, and the pure logic behind them, from Atlassian Document Format to the columns.

/** Jira's own buckets for a status, whatever the workflow calls it. */
export type JiraCategory = 'new' | 'indeterminate' | 'done';

/** A ticket on the Jira tab: one of the epic's direct children. */
export interface JiraTicket {
  key: string;
  summary: string;
  /** Story, Bug, Task… */
  type: string;
  /** Empty when the project doesn't use priorities. */
  priority: string;
  /** Display name; missing when nobody is assigned. */
  assignee?: string;
  status: string;
  category: JiraCategory;
  /** The ticket's page in Jira. */
  url: string;
  /** ISO time. */
  updated: string;
}

/** The Jira tab of a floor's issue board. */
export interface JiraBoardState {
  /** The epic whose children these are, e.g. EDP-168. */
  epic: string;
  items: JiraTicket[];
  fetchedAt: number;
  loading: boolean;
  error?: string;
}

export interface JiraComment {
  id: string;
  author: string;
  /** Converted from Atlassian Document Format to markdown. */
  body: string;
  created: string;
}

/** Everything the ticket window shows beyond the card: GET /api/jira/ticket?key=… */
export interface JiraTicketDetail extends JiraTicket {
  /** Markdown, converted from Atlassian Document Format. */
  description: string;
  reporter?: string;
  created: string;
  comments: JiraComment[];
}

/** Who the office reads Jira as. Never the token. */
export interface JiraConnection {
  /** https://<site>.atlassian.net */
  site: string;
  email: string;
  /** The account's display name; the email when a read-only token can't say. */
  name: string;
  by: string;
  at: number;
}

/** The epic a floor shows. */
export interface JiraEpic {
  key: string;
  summary: string;
  by: string;
  at: number;
}

/** Jira on the floor you're on: the office's connection, and this floor's epic. */
export interface JiraFloorState {
  connection?: JiraConnection;
  epic?: JiraEpic;
}

const KEY = /^[A-Z][A-Z0-9_]*-[1-9]\d*$/;

/** EDP-168, in capitals; undefined when it isn't a Jira issue key. */
export function jiraKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const k = value.trim().toUpperCase();
  return k.length <= 40 && KEY.test(k) ? k : undefined;
}

// ---- Atlassian Document Format -------------------------------------------------------------------

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function inline(nodes: AdfNode[] | undefined): string {
  return (nodes ?? []).map(inlineNode).join('');
}

function inlineNode(n: AdfNode): string {
  switch (n.type) {
    case 'text': {
      let t = n.text ?? '';
      let link = '';
      for (const m of n.marks ?? []) {
        if (m.type === 'code') t = `\`${t}\``;
        else if (m.type === 'strong') t = `**${t}**`;
        else if (m.type === 'em') t = `*${t}*`;
        else if (m.type === 'strike') t = `~~${t}~~`;
        else if (m.type === 'link') link = str(m.attrs?.href);
      }
      return link ? `[${t}](${link})` : t;
    }
    case 'hardBreak':
      return '  \n';
    case 'mention':
      return `@${str(n.attrs?.text).replace(/^@/, '') || 'someone'}`;
    case 'emoji':
      return str(n.attrs?.text) || str(n.attrs?.shortName);
    case 'inlineCard':
      return str(n.attrs?.url);
    case 'date': {
      const ms = Number(n.attrs?.timestamp);
      return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : '';
    }
    case 'status':
      return `[${str(n.attrs?.text)}]`;
    default:
      return n.content ? inline(n.content) : (n.text ?? '');
  }
}

function indent(text: string, pad: string): string {
  return text
    .split('\n')
    .map((l, i) => (i === 0 || !l ? l : pad + l))
    .join('\n');
}

function block(n: AdfNode): string {
  switch (n.type) {
    case 'paragraph':
      return inline(n.content);
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(n.attrs?.level) || 1));
      return `${'#'.repeat(level)} ${inline(n.content)}`;
    }
    case 'bulletList':
      return (n.content ?? []).map((li) => `- ${indent(listItem(li), '  ')}`).join('\n');
    case 'orderedList': {
      const start = Number(n.attrs?.order) || 1;
      return (n.content ?? []).map((li, i) => `${start + i}. ${indent(listItem(li), '   ')}`).join('\n');
    }
    case 'taskList':
      return (n.content ?? []).map((t) => `- [${t.attrs?.state === 'DONE' ? 'x' : ' '}] ${inline(t.content)}`).join('\n');
    case 'codeBlock': {
      const lang = str(n.attrs?.language);
      return `\`\`\`${lang}\n${(n.content ?? []).map((t) => t.text ?? '').join('')}\n\`\`\``;
    }
    case 'blockquote':
    case 'panel':
      return blocks(n.content)
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n');
    case 'rule':
      return '---';
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media':
      return '_(attachment: open the ticket in Jira to see it)_';
    case 'blockCard':
    case 'embedCard':
      return str(n.attrs?.url);
    case 'table':
      return table(n);
    case 'expand':
    case 'nestedExpand':
      return [str(n.attrs?.title) ? `**${str(n.attrs?.title)}**` : '', blocks(n.content)].filter(Boolean).join('\n\n');
    default:
      return n.content ? blocks(n.content) : inlineNode(n);
  }
}

function listItem(li: AdfNode): string {
  return (li.content ?? []).map(block).join('\n');
}

function table(n: AdfNode): string {
  const rows = (n.content ?? []).map((row) => (row.content ?? []).map((cell) => blocks(cell.content).replace(/\n+/g, ' ').replace(/\|/g, '\\|')));
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
  return [line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n');
}

function blocks(nodes: AdfNode[] | undefined): string {
  return (nodes ?? [])
    .map(block)
    .filter((b) => b !== '')
    .join('\n\n');
}

/** A description or comment in Atlassian Document Format, as the office's markdown. A plain string passes through. */
export function adfToMarkdown(doc: unknown): string {
  if (typeof doc === 'string') return doc;
  if (!doc || typeof doc !== 'object') return '';
  const d = doc as AdfNode;
  return (d.type === 'doc' ? blocks(d.content) : block(d)).trim();
}

// ---- The board ---------------------------------------------------------------------------------------

/** The JQL for the Jira tab: every direct child of the epic, in rank order. */
export function childrenJql(epic: string): string {
  return `parent = ${epic} ORDER BY Rank ASC`;
}

/** The Jira tab's columns: Jira's status categories, which is how a board's To Do, In Progress and Done columns are usually drawn. */
export const JIRA_COLUMNS: { name: string; category: JiraCategory }[] = [
  { name: 'To Do', category: 'new' },
  { name: 'In Progress', category: 'indeterminate' },
  { name: 'Done', category: 'done' },
];

/** The tickets in each of the Jira tab's columns, in rank order. */
export function ticketColumns(items: JiraTicket[]): { name: string; items: JiraTicket[] }[] {
  return JIRA_COLUMNS.map((c) => ({ name: c.name, items: items.filter((t) => t.category === c.category) }));
}

/** The task a worker gets for a Jira ticket from the Jira tab. The office only reads Jira; the worker updates the ticket itself, if told to. */
export function ticketPrompt(t: { key: string; summary: string; description?: string; url?: string }): string {
  const description = (t.description ?? '').trim();
  return `Work on Jira ticket ${t.key}: "${t.summary}".${t.url ? `\n\n${t.url}` : ''}\n\n${description || '(No description.)'}`;
}
