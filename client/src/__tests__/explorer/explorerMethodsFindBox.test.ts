import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getDictionaryNames: vi.fn(() => ['UserGlobals', 'Globals']),
}));

import * as vscode from '../../__mocks__/vscode';
import { ExplorerController, FilterChipItem } from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';

/**
 * The Methods pane narrows with VS Code's own find box — the one that opens inside the tree
 * and, with its toggle on, hides the rows that don't match — rather than the floating
 * quick-input box the other three panes still use (#523 tracks moving them over).
 *
 * The point of the swap is that the box lives in the pane: nothing has to decide what a click
 * elsewhere means, and VS Code maps a clicked row back to its element itself, so a filtered
 * click cannot land on the wrong row (#518).
 *
 * There is no API for the widget, so `list.find` — which acts on whichever list was focused
 * last — has to be aimed by focusing the pane first. Getting that order wrong opens the find
 * box over some other tree, which is exactly the kind of thing no other test would catch.
 */

const METHODS = 'gemstoneExplorerMethods';
const DICTS = 'gemstoneExplorerDicts';

function makeController(): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.className = 'Demo';
  ctl.state.dictIndex = 1;
  return ctl;
}

/** The commands run, in order. */
const commandsRun = (): string[] =>
  vi.mocked(vscode.commands.executeCommand).mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Methods pane: VS Code's find box", () => {
  it('focuses the pane before opening the find box, so the box lands on it', async () => {
    const ctl = makeController();

    await ctl.openPaneFindWidget(METHODS);

    expect(commandsRun()).toEqual([`${METHODS}.focus`, 'list.find']);
  });

  it('opens the find box from the pane filter button instead of a filter input', async () => {
    const ctl = makeController();

    await ctl.beginFilter(METHODS);

    expect(commandsRun()).toContain('list.find');
    expect(vscode.window.createInputBox).not.toHaveBeenCalled();
  });

  // The Filter button's command handler returns this promise, so VS Code reports a failing
  // focus/find command. Swallowed, the button would look like it simply did nothing — the
  // hardest kind of breakage to notice if a command id changes underneath us.
  it('lets a failing focus/find command out, rather than failing silently', async () => {
    const ctl = makeController();
    vi.mocked(vscode.commands.executeCommand).mockRejectedValueOnce(new Error('no such command'));

    await expect(ctl.beginFilter(METHODS)).rejects.toThrow('no such command');
  });

  it('still opens the filter input for a pane that has not moved over yet', async () => {
    const ctl = makeController();

    await ctl.beginFilter(DICTS);

    expect(vscode.window.createInputBox).toHaveBeenCalled();
    expect(commandsRun()).not.toContain('list.find');
  });

  // A quick-input box does not get out of the way by itself (it sets ignoreFocusOut), so one
  // left open over another pane would sit on top of the find box we are about to open. Closing
  // it as an accept matches what a click on a row does: asking to search the Methods pane says
  // nothing about the filter the user already typed elsewhere.
  it('puts away a filter input left open over another pane, keeping its filter', async () => {
    const ctl = makeController();

    await ctl.beginFilter(DICTS);
    const box = vi.mocked(vscode.window.createInputBox).mock.results.at(-1)!.value as {
      hide: ReturnType<typeof vi.fn>;
      __type: (text: string) => void;
    };
    box.__type('Glo');

    await ctl.openPaneFindWidget(METHODS);

    expect(box.hide).toHaveBeenCalled();
    expect(ctl.getFilter(DICTS)).toBe('Glo');
  });

  // The reads:/writes:/accesses: filters are the reason the pane keeps filter state at all:
  // they run a GemStone query no text search could, and are seeded from an instance variable's
  // context menu. VS Code's box then searches within the rows they picked.
  it('leaves an instance-variable filter on the pane, for the find box to search within', () => {
    const ctl = makeController();
    ctl.filterMethodsByIvar('reads', 'count', 'Demo');

    expect(ctl.getFilter(METHODS)).toBe('reads:count');
  });

  it('tells the user the chip clears rather than edits, there being no editor to open', () => {
    expect(new FilterChipItem(METHODS, 'reads:count').tooltip).toBe(
      'Active filter: reads:count — click to search within it, ✕ to clear',
    );
  });

  it('keeps offering the editor on a pane that still has one', () => {
    expect(new FilterChipItem(DICTS, 'Glo').tooltip).toBe(
      'Active filter: Glo — click to edit, ✕ to clear',
    );
  });
});

// The button is contributed in package.json and dispatched by view id, so a rename on either
// side silently leaves the pane with a button that opens nothing.
describe('Methods pane filter button', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'gemstoneExplorer.ts'), 'utf-8');

  it('is the same command the other panes use, so one handler serves all four', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../../package.json'), 'utf8'),
    ) as { contributes: { commands: { command: string }[] } };

    expect(pkg.contributes.commands.map((c) => c.command)).toContain(`${METHODS}.filter`);
    // Returned, not dropped: the handler's promise is how a failing focus/find command
    // gets reported (see beginFilter).
    expect(src).toContain('registerCommand(`${viewId}.filter`, () => ctl.beginFilter(viewId))');
  });
});
