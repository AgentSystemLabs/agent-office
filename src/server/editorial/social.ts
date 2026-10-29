import { hashText, id, json, now } from './ids.js';
import type { EditorialDocuments } from './documents.js';
import type { EditorialRepository } from './repository.js';
import type { ProjectRecord, SocialAccountRecord, SocialPostRecord } from './types.js';

export interface SocialPublishResult {
  remoteId: string;
  remoteUrl?: string;
  evidence: { kind: 'service'; ref: string; observedAt: string; note?: string };
}

export interface SocialConnector {
  readonly platform: string;
  readonly configured: boolean;
  publish(content: string, scheduledAt?: string): Promise<SocialPublishResult>;
}

/**
 * Optional Mastodon connector. It follows the official `POST /api/v1/statuses` contract and only
 * marks a post published after the instance returns a remote id. Ref:
 * https://docs.joinmastodon.org/methods/statuses/
 */
export class MastodonConnector implements SocialConnector {
  readonly platform = 'mastodon';
  readonly configured: boolean;
  private readonly baseUrl?: string;

  constructor(baseUrl?: string, private readonly accessToken?: string, private readonly fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl?.replace(/\/$/, '');
    this.configured = !!this.baseUrl && !!accessToken;
  }

  async publish(content: string, scheduledAt?: string): Promise<SocialPublishResult> {
    if (!this.configured || !this.baseUrl || !this.accessToken) throw new Error('Mastodon connector is not configured');
    const body = { status: content, ...(scheduledAt ? { scheduled_at: scheduledAt } : {}) };
    const response = await this.fetchImpl(`${this.baseUrl}/api/v1/statuses`, { method: 'POST', headers: { authorization: `Bearer ${this.accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (!response.ok || !payload || typeof payload.id !== 'string') throw new Error(`Mastodon publish failed (${response.status})`);
    return { remoteId: payload.id, remoteUrl: typeof payload.url === 'string' ? payload.url : undefined, evidence: { kind: 'service', ref: `${this.baseUrl}/api/v1/statuses`, observedAt: now(), note: 'Remote response contained a status id.' } };
  }
}

export class EditorialMarketing {
  readonly mastodon: MastodonConnector;

  constructor(private readonly repo: EditorialRepository, private readonly documents: EditorialDocuments, baseUrl?: string, token?: string, fetchImpl?: typeof fetch) {
    this.mastodon = new MastodonConnector(baseUrl, token, fetchImpl);
    if (this.mastodon.configured) this.repo.upsertSocialAccount({ id: 'mastodon-default', platform: 'mastodon', accountLabel: 'Mastodon configurado', tokenRef: 'MASTODON_ACCESS_TOKEN', capabilities: ['publish-status'], status: 'configured', metadata: { baseUrl }, updatedAt: now() });
  }

  createPost(project: ProjectRecord, content: string, scheduledAt?: string, accountId?: string): SocialPostRecord {
    const post: SocialPostRecord = { id: id('social_post'), projectId: project.id, accountId, contentHash: hashText(content), content: { text: content, approved: false }, scheduledAt, timezone: 'UTC', state: scheduledAt ? 'scheduled' : 'draft', updatedAt: now() };
    this.repo.createSocialPost(post);
    this.repo.audit('owner', 'social.post.create', project.id, undefined, post.contentHash, { postId: post.id, accountId, scheduledAt });
    return post;
  }

  approvePost(postId: string): boolean {
    const changed = this.repo.updateSocialPost(postId, { state: 'approved' });
    if (changed) this.repo.audit('owner', 'social.post.approve', undefined, undefined, undefined, { postId });
    return changed;
  }

  async publishPost(postId: string): Promise<SocialPostRecord> {
    const post = this.repo.listSocialPosts().find((candidate) => candidate.id === postId);
    if (!post) throw new Error('Social post not found');
    if (post.state !== 'approved') throw new Error('Social post needs owner approval before publishing');
    if (post.accountId && post.accountId !== 'mastodon-default') throw new Error('No connector is registered for this social account');
    const result = await this.mastodon.publish(String(post.content.text ?? ''), post.scheduledAt);
    this.repo.updateSocialPost(post.id, { state: post.scheduledAt ? 'scheduled_remote' : 'published', remoteId: result.remoteId, remoteUrl: result.remoteUrl });
    this.repo.audit('owner', 'social.post.remote-publish', post.projectId, undefined, post.contentHash, { postId, platform: 'mastodon', remoteId: result.remoteId });
    return this.repo.listSocialPosts(post.projectId).find((candidate) => candidate.id === postId) ?? post;
  }

  exportCalendar(project: ProjectRecord): ReturnType<EditorialDocuments['writeTextArtifact']> {
    const posts = this.repo.listSocialPosts(project.id);
    const text = ['# Calendario social', '', ...posts.map((post) => `- ${post.scheduledAt || 'sin fecha'} · ${post.state} · ${String(post.content.text ?? '').replaceAll('\n', ' ')}`)].join('\n');
    return this.documents.writeTextArtifact(project, 'social_piece', 'social', text, { format: 'calendar', postIds: posts.map((post) => post.id), connector: this.mastodon.configured ? 'mastodon-configured' : 'assisted-export' });
  }
}

export function socialContentHash(content: Record<string, unknown>): string {
  return hashText(json(content));
}
