// Manual double-click detection for VS Code TreeViews, which expose no
// double-click event: a row's `command` fires on every click, so we time
// consecutive clicks on the same key. Pure and clock-injectable so it can be
// unit-tested without real time. Used by the GemStone Explorer's Classes pane to
// open a class definition on double-click (a single click just navigates), and by
// its Methods pane to keep a method's tab open.
export class DoubleClickDetector {
  private last = { key: '', time: 0 };

  constructor(
    private readonly thresholdMs = 500,
    private readonly now: () => number = Date.now,
  ) {}

  // Records a click on `key`; returns true when it completes a double-click
  // (same key, strictly within the threshold), resetting so a following click
  // starts a fresh pair.
  private register(key: string): boolean {
    const t = this.now();
    if (key === this.last.key && t - this.last.time < this.thresholdMs) {
      this.last = { key: '', time: 0 };
      return true;
    }
    this.last = { key, time: t };
    return false;
  }

  // Records a click, says whether it completes a pair, and returns a way to take it back, so
  // one that changed nothing can't start a pair. Taking it back does nothing once a
  // later click is recorded, even one on the same key.
  click(key: string): { completesPair: boolean; withdraw: () => void } {
    const completesPair = this.register(key);
    const recorded = this.last;
    return {
      completesPair,
      withdraw: () => {
        if (this.last === recorded) this.last = { key: '', time: 0 };
      },
    };
  }
}
