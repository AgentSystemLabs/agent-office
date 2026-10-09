/** Keeps repeated Start clicks from launching duplicate checkouts or seating duplicate workers. */
export class MeetingPreparation {
  private controller?: AbortController;

  get busy(): boolean { return !!this.controller; }

  async run(start: (signal: AbortSignal) => Promise<string | undefined>): Promise<string | undefined> {
    if (this.controller) return 'The meeting worktree is already being prepared; please wait or stop it first';
    const controller = this.controller = new AbortController();
    try {
      return await start(controller.signal);
    } catch (err) {
      return `Could not start the meeting: ${(err as Error).message}`;
    } finally {
      this.controller = undefined;
    }
  }

  cancel(): boolean {
    if (!this.controller) return false;
    this.controller.abort();
    return true;
  }
}
