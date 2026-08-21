import * as vscode from 'vscode';

// A Back/Forward history of the gemstone:// editors the user has viewed, so the
// title-bar arrows can retrace steps even when every method opens in the SAME
// reusable preview tab. VS Code's own navigation history doesn't record those
// same-tab preview swaps as distinct locations — it only works once tabs are
// pinned/distinct — so a first-time user single-clicking through methods can't
// get back. This models a browser's history: a linear stack with a cursor, where
// navigating to a new editor truncates any forward entries.
//
// The class owns only the stack logic; the caller injects `open` (reopen a URI)
// so it stays unit-testable without the VS Code window.
export class GemstoneNavigationHistory {
  private readonly history: string[] = [];
  private cursor = -1;
  // The URI our own back()/forward() is about to activate. Reopening it fires an
  // onDidChangeActiveTextEditor echo; matching it here consumes that echo so it
  // isn't recorded as a fresh navigation (which would corrupt the stack). A
  // one-shot compare sidesteps the timing races a boolean "suppress" flag has —
  // the activation event can arrive after the open() promise resolves.
  private expected: string | null = null;

  // `open` reopens a URI and resolves true on success, false when it can't be
  // shown (dead session, deleted method) so the stale entry can be dropped.
  constructor(private readonly open: (uri: vscode.Uri) => Promise<boolean>) {}

  // Record that a gemstone:// editor became active. No-ops for other schemes, for
  // the echo of our own back/forward, and for a repeat of the current entry.
  record(uri: vscode.Uri): void {
    if (uri.scheme !== 'gemstone') return;
    const key = uri.toString();
    if (this.expected === key) {
      this.expected = null;
      return;
    }
    this.expected = null;
    if (this.cursor >= 0 && this.history[this.cursor] === key) return;
    this.history.length = this.cursor + 1; // drop any forward history
    this.history.push(key);
    this.cursor = this.history.length - 1;
  }

  canGoBack(): boolean {
    return this.cursor > 0;
  }

  canGoForward(): boolean {
    return this.cursor >= 0 && this.cursor < this.history.length - 1;
  }

  async back(): Promise<void> {
    if (this.canGoBack()) await this.step(this.cursor - 1);
  }

  async forward(): Promise<void> {
    if (this.canGoForward()) await this.step(this.cursor + 1);
  }

  private async step(target: number): Promise<void> {
    const key = this.history[target];
    this.expected = key;
    let ok = false;
    try {
      ok = await this.open(vscode.Uri.parse(key));
    } catch {
      ok = false;
    }
    if (ok) {
      this.cursor = target;
      return;
    }
    // Couldn't reopen: drop the stale entry and keep the cursor on the current
    // editor, so a second press tries the next one along instead of getting stuck.
    this.expected = null;
    this.history.splice(target, 1);
    if (target < this.cursor) this.cursor--;
  }
}
