import * as vscode from 'vscode';
import { ProcessManager } from './processManager';
import { needsWsl, refreshWslNetworkInfo } from '../wslBridge';

/**
 * Re-reads the running GemStone servers and says when the answer may have moved.
 *
 * This was a `TreeDataProvider` while the servers had a sidebar view of their
 * own. That view is gone — a database's processes are a row on its Databases &
 * Versions panel now — but the two jobs the provider did around rendering are
 * still needed: something has to ask `gslist` again after an action, and
 * something has to re-probe the WSL network, whose IP does not survive a
 * restart. So what is left is those two jobs and the event, with no tree.
 */
export class ProcessWatcher {
  private _onDidChange = new vscode.EventEmitter<void>();
  /** Fires when the process list, or the WSL network behind it, may have changed. */
  readonly onDidChange = this._onDidChange.event;
  private networkRefreshInFlight = false;

  constructor(private processManager: ProcessManager) {}

  refresh(): void {
    this.processManager.refreshProcesses();
    // WSL IP is unstable across restarts, so re-probe alongside each gslist
    // refresh. Fire-and-forget: listeners get what was cached last, and are
    // told again when the probe lands.
    this.scheduleWslNetworkRefresh();
    this._onDidChange.fire();
  }

  private scheduleWslNetworkRefresh(): void {
    if (!needsWsl() || this.networkRefreshInFlight) return;
    this.networkRefreshInFlight = true;
    refreshWslNetworkInfo()
      .finally(() => {
        this.networkRefreshInFlight = false;
      })
      .then(() => this._onDidChange.fire())
      .catch(() => {
        /* already swallowed in refreshWslNetworkInfo */
      });
  }
}
