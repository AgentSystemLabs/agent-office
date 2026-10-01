import type { MaintenanceIssues } from '../shared/protocol.js';
import { GitHub, gh } from './github.js';
import { originRepo } from './building.js';
import type { GhAs } from './signins.js';
import { officeSourceDir } from './maintenance.js';

/** A separate GitHub feed, rooted in the office source rather than a floor's project. */
export class MaintenanceBoard {
  private github?: GitHub;
  state: MaintenanceIssues = { items: [], fetchedAt: 0, loading: false };

  constructor(private emit: (state: MaintenanceIssues) => void, private source = officeSourceDir()) {
    if (this.source) {
      const repo = originRepo(this.source);
      if (repo) {
        this.state.repo = repo;
        this.github = new GitHub(this.source, (state) => this.set({ ...state, repo: this.state.repo }), () => {}, repo);
      } else this.state.error = "The office source needs a GitHub origin remote for its maintenance issues board";
    }
    else this.state.error = "Can't find Agent Office's own source (set AGENT_OFFICE_SOURCE)";
  }

  private set(state: MaintenanceIssues) {
    this.state = state;
    this.emit(state);
  }

  start() {
    this.github?.start();
    void this.identify();
  }

  stop() { this.github?.stop(); }

  private async identify() {
    if (!this.github) return;
    try {
      const repo = (await this.github.repoInfo()).nameWithOwner;
      this.set({ ...this.state, repo });
    } catch {
      // The issue feed carries an actionable GitHub error. Retry identity on refresh.
    }
  }

  async refresh() {
    await Promise.all([this.github?.refresh(), this.identify()]);
  }

  async create(title: string, body: string, as?: GhAs) {
    if (!this.github || !this.source || !this.state.repo) throw new Error(this.state.error ?? 'No maintenance repository');
    if (!title.trim() || title.length > 200 || body.length > 20000) throw new Error('Use a title up to 200 characters and a description up to 20,000.');
    const url = (await gh(['issue', 'create', '--repo', this.state.repo, '--title', title.trim(), '--body', body], this.source, undefined, as?.env)).trim();
    const number = Number(/\/issues\/(\d+)$/.exec(url)?.[1]);
    if (!number) throw new Error('GitHub did not return an issue URL');
    void this.refresh();
    return { number, title: title.trim(), url };
  }

  async claim(number: number, as?: GhAs) {
    await this.issue(number);
    return this.github!.claim(number, as);
  }

  async request(number: number) {
    await this.refresh();
    if (this.state.error) throw new Error(this.state.error);
    const detail = await this.issue(number);
    if (detail.state !== 'OPEN') throw new Error('Reopen this issue before starting Maintenance');
    const issue = this.state.items.find((item) => item.number === number);
    if (!issue) throw new Error('Refresh the maintenance board before starting this issue');
    return `Implement Agent Office issue #${number}: ${issue.title}\nhttps://github.com/${this.state.repo}/issues/${number}\n\n${detail.body}`;
  }

  async issue(number: number, viewer?: string) {
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Bad issue number');
    if (!this.github) throw new Error(this.state.error);
    return this.github.issueDetail(number, viewer);
  }
}
