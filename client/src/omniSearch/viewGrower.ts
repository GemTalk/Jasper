import * as vscode from 'vscode';

// How tall a pane is made for results shown on the Jasper Assistant's behalf, in CSS pixels: room
// for the chrome plus several rows. VS Code has no way to set a panel's size, only to resize the
// active part a step at a time; see growTo.
export const ASSISTANT_RESULTS_MIN_HEIGHT = 320;
const MAX_GROW_STEPS = 16;

/** Grows the panel a webview view sits in, from the heights its page reports (`viewHeight`). */
export class ViewGrower {
  private height = 0;
  private onHeight: (() => void) | undefined;

  /** The page's latest height report. */
  report(px: number): void {
    this.height = px;
    this.onHeight?.();
  }

  /** Grow the panel until the view is at least `minPx` tall. The step commands act on whichever part
   *  VS Code counts as active, which after a reveal can still be the editor area: there "increase"
   *  grows the editor and shrinks this panel. So each step is checked, and a step that shrank the
   *  view switches to the opposite command, which then grows it. Stops when a step changes nothing
   *  (the panel is as tall as the window lets it be) or no height report comes back. `firstWaitMs`
   *  is how long to wait for the first report, which a view still loading sends late. */
  async growTo(minPx: number, firstWaitMs = 250): Promise<void> {
    if (this.height === 0) await this.nextHeight(firstWaitMs);
    let command = 'workbench.action.increaseViewHeight';
    for (let step = 0; step < MAX_GROW_STEPS && this.height < minPx; step++) {
      const before = this.height;
      await vscode.commands.executeCommand(command);
      await this.nextHeight(250);
      if (this.height < before && command === 'workbench.action.increaseViewHeight') {
        command = 'workbench.action.decreaseViewHeight';
        continue;
      }
      if (this.height <= before) return;
    }
  }

  /** Settles on the page's next height report, or after `waitMs` if none comes. */
  private nextHeight(waitMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.onHeight = undefined;
        resolve();
      };
      const timer = setTimeout(done, waitMs);
      this.onHeight = done;
    });
  }
}
