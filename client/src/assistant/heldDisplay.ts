/**
 * Holds what the Jasper Assistant's tools show while it is still answering, and shows it all
 * when the answer ends. Each tool call is a separate step of the model, seconds apart, so
 * shown at once the Search list, the Explorer and the example Workspace would change one by one
 * while the answer was still being written.
 *
 * The tools still do their work on the stone at once (an example is still checked, a class list
 * still fetched); only the change to the screen waits. Holding is per window, not per caller:
 * another Claude Code using this window's MCP server while the assistant answers is held too.
 */
export class HeldDisplay {
  private holding = false;
  private queue: Array<() => Promise<unknown>> = [];

  constructor(private readonly onError: (message: string) => void) {}

  /** The assistant has started an answer. */
  hold(): void {
    this.holding = true;
  }

  /** The answer has ended, finished or not: show what was held, in the order it came. A failure
   *  is reported and does not stop the rest. */
  async release(): Promise<void> {
    this.holding = false;
    const queue = this.queue;
    this.queue = [];
    for (const show of queue) {
      try {
        await show();
      } catch (err) {
        this.onError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  /** Run `show` now and answer what it says, or, while an answer is in progress, keep it for
   *  `release` and answer `heldText`, which tells the model what will be shown. */
  async show(show: () => Promise<string>, heldText: string): Promise<string> {
    if (!this.holding) return await show();
    this.queue.push(show);
    return heldText;
  }
}
