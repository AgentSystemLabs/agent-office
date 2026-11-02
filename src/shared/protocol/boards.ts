// Custom boards provided by plugins (e.g. task boards, issue trackers).

export interface BoardParent {
  id: string;
  key?: string;
  title?: string;
  url?: string;
}

export interface BoardCard {
  id: string;
  number?: number;
  title: string;
  body?: string;
  column?: string;
  state?: 'OPEN' | 'CLOSED';
  author?: string;
  authorAvatarUrl?: string;
  assignees?: string[];
  assigneeAvatarUrl?: string;
  parent?: BoardParent;
  storyPoints?: number;
  url?: string;
  labels?: Array<{ name: string; color?: string }>;
  comments?: number;
  priority?: string;
  type?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BoardCardDetail extends BoardCard {
  commentsList?: Array<{ author: string; avatarUrl?: string; body: string; createdAt: string }>;
}

export interface BoardFieldConfig {
  key: string;
  label: string;
  type?: 'text' | 'password' | 'url';
  placeholder?: string;
  required?: boolean;
}

export interface CustomBoardDef {
  id: string;
  label: string;
  icon: string;
  description?: string;
  columns?: string[];
  configFields?: BoardFieldConfig[];
}

export interface CustomBoardState {
  def: CustomBoardDef;
  cards: BoardCard[];
  columns?: string[];
  currentUser?: { displayName?: string; email?: string; name?: string };
  fetchedAt?: number;
  loading?: boolean;
  error?: string;
}

export type BoardsClientMsg =
  | { t: 'board.refresh'; boardId: string };

export type BoardsServerMsg =
  | { t: 'board.state'; boardId: string; state: CustomBoardState };
