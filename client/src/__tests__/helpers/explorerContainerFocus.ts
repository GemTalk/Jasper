/**
 * Shared by the two suites that assert a jump brings the GemStone Explorer's
 * activity-bar container up: explorerContainerFocus.test.ts (the controller's
 * jumps) and omniSearch/__tests__/omniSearchExplorerFocus.test.ts (GemStone
 * Search's). One copy, because both make the same claim about the same
 * implementation detail and a claim asserted two ways drifts.
 *
 * The container focus is matched LOOSELY, by looking for any executed command
 * that opens the container, because what matters is that SOMETHING brings it up
 * — not which of `workbench.view.extension.gemstoneExplorer` or a pane's own
 * `<viewId>.focus` does it. `showsTheExplorerContainer` is the one definition of
 * "that set of commands", and the stub below flips its views on the SAME set, so
 * a future change really can swap one for the other without rewriting the tests
 * that rely on this: with the matcher and the stub reading one predicate, a
 * matched command is by construction a command the stub reacts to.
 */
import { vi } from 'vitest';

/** Does this command id bring the Explorer's container up? */
export function showsTheExplorerContainer(command: string): boolean {
  return (
    command === 'workbench.view.extension.gemstoneExplorer' ||
    command === 'workbench.view.extension.gemstoneExplorer.focus' ||
    (/^gemstoneExplorer/.test(command) && command.endsWith('.focus'))
  );
}

/** Did anything in this run bring the Explorer's container up? */
export function focusedTheExplorerContainer(executeCommand: ReturnType<typeof vi.fn>): boolean {
  return executeCommand.mock.calls.map((c) => String(c[0])).some(showsTheExplorerContainer);
}

/** A TreeView stub. `visible` is the flag `revealCascade` gates on. */
export function fakeView(visible = true) {
  return { reveal: vi.fn(async () => {}), selection: [] as unknown[], description: '', visible };
}

export type FakeViews = ReturnType<typeof fakeViews>;

export function fakeViews(visible = true) {
  return {
    dict: fakeView(visible),
    category: fakeView(visible),
    klass: fakeView(visible),
    hierarchy: fakeView(visible),
    method: fakeView(visible),
  };
}

/**
 * Model what VS Code does when the container is shown: the views inside it
 * become visible — after a tick, not synchronously.
 *
 * The delay is the point. VS Code resolves the tree views inside a container
 * AFTER the container command has returned, and a stub that flips `visible`
 * synchronously passes whether or not the code waits for them — which is exactly
 * how the first version of these tests passed against broken code. `delayMs: 0`
 * still defers to a timer, so even the "already visible" cases are modelled the
 * way the editor really behaves.
 */
export function flipVisibleOnContainerShow(
  executeCommand: ReturnType<typeof vi.fn>,
  views: Record<string, { visible: boolean }>,
  delayMs = 40,
): void {
  executeCommand.mockImplementation((command: unknown) => {
    if (showsTheExplorerContainer(String(command))) {
      setTimeout(() => {
        for (const v of Object.values(views)) v.visible = true;
      }, delayMs);
    }
    return Promise.resolve(undefined);
  });
}
