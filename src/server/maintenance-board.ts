import type { MaintenanceIssues } from '../shared/protocol.js';
import { GitHub } from './github.js';
import { officeSourceDir } from './maintenance.js';

/** A separate GitHub feed, rooted in the office source rather than a floor's project. */
export class MaintenanceBoard {
  private github?: GitHub;
  state: MaintenanceIssues = { items: [], fetchedAt: 0, loading: false };

  constructor(private emit: (state: MaintenanceIssues) => void, source = officeSourceDir()) {
    if (source) this.github = new GitHub(source, (state) => this.set({ ...state, repo: this.state.repo }), () => {});
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

  async issue(number: number, viewer?: string) {
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Bad issue number');
    if (!this.github) throw new Error(this.state.error);
    return this.github.issueDetail(number, viewer);
  }
}
