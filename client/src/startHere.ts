import * as vscode from 'vscode';

// A first-time user who just connected lands in the raw kernel with no signpost to
// the basics — browse a class, open a workspace, search (issue #468, item 10). This
// module surfaces those without getting in a power user's way:
//
//   • a left status-bar "Start Here" button, shown on connect, that opens a quick
//     pick of the basics and retires itself once the user engages or starts browsing
//   • a `gemstone.startHere` command exposing that same quick pick on demand (Command
//     Palette, and the status-bar button)
//
// A status-bar button is used rather than a toast on purpose: a once-ever
// notification is transient and easy to miss (and a returning power user should never
// see it), whereas the button is always there when it's relevant and simply absent
// once you've found your way.

const START_HERE_STATUS_COMMAND = 'gemstone.startHere.fromStatusBar';
export const START_HERE_RETIRED_KEY = 'gemstone.startHereRetired';

// One entry in the Start Here hub: a labelled action that runs an existing GemStone
// command. Kept as data (not inline in the QuickPick call) so the set is unit-testable.
export interface StartHereItem {
  label: string;
  detail: string;
  command: string;
}

// The basics a newly-connected user most needs, in the order they'd usually want
// them. Each dispatches to a command that already exists — this is a signpost, not
// new behavior.
export function startHereItems(): StartHereItem[] {
  return [
    {
      label: '$(search) Browse a class',
      detail: 'Jump to any class by name and reveal it in the GemStone Explorer',
      command: 'gemstone.findClass',
    },
    {
      label: '$(search-fuzzy) Search your code',
      detail: 'One box across classes, methods, and method source',
      command: 'gemstone.search',
    },
    {
      label: '$(notebook) Open a workspace',
      detail: 'A scratch buffer for trying out Smalltalk expressions',
      command: 'gemstone.openWorkspace',
    },
    {
      label: '$(mortar-board) Take the tour',
      detail: 'Reopen the Get Started with GemStone walkthrough',
      command: 'gemstone.openWalkthrough',
    },
  ];
}

// Sentinel "command" for the menu's own Hide action — intercepted rather than
// dispatched to vscode.commands (see showStartHereMenu).
const HIDE_ACTION = '__startHere.hide';

// Show the Start Here hub and run whatever the user picks. No-op if they dismiss it.
// When `onHide` is supplied (the status-bar button passes it), the menu offers an
// explicit "Hide the Start Here button" entry that calls it; the plain Command
// Palette entry omits that (there's no button to hide).
export async function showStartHereMenu(onHide?: () => void | Promise<void>): Promise<void> {
  const items = startHereItems();
  if (onHide) {
    items.push({
      label: '$(eye-closed) Hide the Start Here button',
      detail: 'Bring it back later with “GemStone: Reset Getting Started”',
      command: HIDE_ACTION,
    });
  }
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'New to Jasper? Start here…',
    matchOnDetail: true,
  });
  if (!picked) return;
  if (picked.command === HIDE_ACTION) {
    await onHide?.();
    return;
  }
  await vscode.commands.executeCommand(picked.command);
}

// A left status-bar "Start Here" button for a newly-connected user. It shows on
// connect and stays put — it never auto-retires (it's unobtrusive enough to leave for
// a power user), so the only ways it goes away are the explicit "Hide the Start Here
// button" menu entry or losing the connection. A hide is persisted, and
// `gemstone.resetGettingStarted` brings it back.
export class StartHereStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
    this.item.text = '$(mortar-board) GemStone - Start Here';
    // Purple foreground to stand out from the neutral status bar. `charts.purple` is
    // a theme-defined color, so it stays a sensible purple in light and dark themes
    // rather than a fixed hex that reads wrong in one of them. (Only the status-bar
    // background is restricted to warning/error; the foreground color is free.)
    this.item.color = new vscode.ThemeColor('charts.purple');
    this.item.tooltip =
      'New to Jasper? Browse a GemStone class, search your code, open a workspace, or take the tour.';
    this.item.command = START_HERE_STATUS_COMMAND;
  }

  private get hidden(): boolean {
    return !!this.context.globalState.get<boolean>(START_HERE_RETIRED_KEY);
  }

  // Persistently hide the button (the menu's explicit Hide action). Reversible via
  // resetStartHere.
  private async hidePermanently(): Promise<void> {
    this.item.hide();
    await this.context.globalState.update(START_HERE_RETIRED_KEY, true);
  }

  // Show the button on connect, unless the user has hidden it.
  showForConnection(): void {
    if (!this.hidden) this.item.show();
  }

  // Hide when the last session goes away. Not persisted: a later reconnect shows it
  // again (unless it was hidden explicitly).
  hideForDisconnection(): void {
    this.item.hide();
  }

  register(): vscode.Disposable[] {
    return [
      this.item,
      // Clicking the button just opens the hub — dismissing the hub leaves the button
      // in place. It goes away only via the hub's explicit Hide entry.
      vscode.commands.registerCommand(START_HERE_STATUS_COMMAND, () =>
        showStartHereMenu(() => this.hidePermanently()),
      ),
    ];
  }
}

// Register the `gemstone.startHere` command (the hub, also reachable from the status
// bar button and the Command Palette).
export function registerStartHere(): vscode.Disposable {
  return vscode.commands.registerCommand('gemstone.startHere', () => showStartHereMenu());
}

// Un-hide the Start Here button so it shows again on the next connect — folded into
// the `gemstone.resetGettingStarted` command so one reset re-arms every first-run
// surface.
export async function resetStartHere(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(START_HERE_RETIRED_KEY, undefined);
}
