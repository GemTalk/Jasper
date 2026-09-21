/**
 * Bringing the GemStone Explorer's activity-bar container up.
 *
 * The Explorer is its own `viewsContainer` (`gemstoneExplorer` in package.json),
 * and a jump into it from somewhere else in Jasper — a GemStone Search hit, the
 * Inspector's or the debugger's Browse, Reveal in GemStone Explorer from a test
 * row — used to cascade the panes and leave the sidebar showing whatever
 * container it was already on. You landed in an editor with no sight of where
 * you had landed in the tree, and had to switch over by hand to see it.
 *
 * It is also what made those cascades no-ops: `revealCascade` skips while its
 * tree view is not `visible`, and a view inside a container that is not showing
 * is not visible. So the focus has to happen BEFORE the cascade, not after.
 *
 * Focusing the container is deliberately NOT the same gesture as re-expanding a
 * collapsed pane, which navigation must never do (see the reveal doc-comment in
 * gemstoneExplorer.ts). This opens the container; which of its six panes are
 * expanded inside it stays the user's business.
 */
import * as vscode from 'vscode';
import { logWarning } from './gciLog';

/** The command VS Code generates for a contributed activity-bar view container:
 *  `workbench.view.extension.<container id>`. Ours is `gemstoneExplorer`. */
const FOCUS_EXPLORER_CONTAINER = 'workbench.view.extension.gemstoneExplorer';

/**
 * Show the GemStone Explorer container, so a reveal into one of its panes lands
 * somewhere the user can see.
 *
 * Await it before cascading: the panes' `visible` flags are what the cascade
 * gates on. Best-effort — a command id we don't own, so a VS Code release that
 * renamed it must cost the jump its sidebar switch, not the jump itself.
 */
export async function focusGemStoneExplorer(): Promise<void> {
  try {
    await vscode.commands.executeCommand(FOCUS_EXPLORER_CONTAINER);
  } catch (e: unknown) {
    logWarning(
      `Could not show the GemStone Explorer: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
