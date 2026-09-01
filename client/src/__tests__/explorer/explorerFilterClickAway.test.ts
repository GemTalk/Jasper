import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getDictionaryNames: vi.fn(() => ['UserGlobals', 'Globals']),
}));

import * as vscode from '../../__mocks__/vscode';
import { __resetConfig } from '../../__mocks__/vscode';
import {
  ExplorerController,
  FilterChipItem,
  commitFilterOnRowSelection,
} from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';

/**
 * Clicking a row in a filtered pane must select the row that was under the pointer (issue #518).
 *
 * The filter box used to close on focus-out, and closing is the cancel path: the pre-edit filter
 * went back and the pane re-expanded to the full list — under the pointer, before the click that
 * dismissed the box resolved — so the click landed on whatever row had moved into that spot.
 * `ignoreFocusOut` keeps the box open through the click (the mock's `__clickAway()` honours the
 * flag, so these drive the real mechanism), and the pane's selection handler commits it instead.
 *
 * The companion contract — Enter keeps, Escape restores — lives in explorerFilterCancel.test.ts.
 *
 * The pane under test is Dictionaries, one of the three still opening the input box. The
 * Methods pane no longer has one: its button opens VS Code's find box, which cannot lose a
 * filter to a click because the box lives in the pane (explorerMethodsFindBox.test.ts).
 */

const DICTS = 'gemstoneExplorerDicts';
const CLASSES = 'gemstoneExplorerClasses';

function makeController(): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.className = 'Demo';
  ctl.state.dictIndex = 1;
  return ctl;
}

/** The InputBox `beginFilter` just created. */
interface MockInputBox {
  value: string;
  hide: ReturnType<typeof vi.fn>;
  __type: (text: string) => void;
  __accept: () => Promise<void>;
  __hide: () => void;
  __clickAway: () => void;
}
function lastInputBox(): MockInputBox {
  return vi.mocked(vscode.window.createInputBox).mock.results.at(-1)!.value;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetConfig();
});

describe('Explorer filter input: clicking a filtered row', () => {
  /** The rows the Dictionaries pane is currently showing (minus the filter chip). */
  const rows = (ctl: ExplorerController): (string | undefined)[] =>
    (ctl.dictProvider.getChildren() as { label?: string }[])
      .filter((r) => !(r instanceof FilterChipItem))
      .map((r) => r.label);

  it('leaves the filtered rows in place when focus goes elsewhere', async () => {
    const ctl = makeController();

    await ctl.beginFilter(DICTS);
    const box = lastInputBox();
    box.__type('Glo');
    expect(rows(ctl)).toEqual(['Globals']);

    box.__clickAway(); // the mouse-down on `Globals`, before the click resolves

    // The bug: this used to be back to the full list, so the click landed on `UserGlobals`.
    expect(rows(ctl)).toEqual(['Globals']);
    expect(ctl.getFilter(DICTS)).toBe('Glo');
  });

  it('keeps the filter and closes the box when a row is selected', async () => {
    const ctl = makeController();

    await ctl.beginFilter(DICTS);
    const box = lastInputBox();
    box.__type('Glo');

    box.__clickAway();
    ctl.commitFilterInput(); // what the pane's selection handler does

    expect(ctl.getFilter(DICTS)).toBe('Glo');
    expect(box.hide).toHaveBeenCalled();
  });

  // A committed box is done with: a later Escape belongs to whatever has focus now, and must
  // not reach back and undo the filter the user clicked a result in.
  it('does not undo the filter when the box is escaped after being committed', async () => {
    const ctl = makeController();

    await ctl.beginFilter(DICTS);
    const box = lastInputBox();
    box.__type('Glo');
    ctl.commitFilterInput();

    box.__hide(); // Escape, after the box has already gone

    expect(ctl.getFilter(DICTS)).toBe('Glo');
  });

  it('does nothing when no filter box is open', () => {
    const ctl = makeController();

    expect(() => ctl.commitFilterInput()).not.toThrow();
    expect(ctl.getFilter(DICTS)).toBeUndefined();
  });

  // Escape reaches the box only while it is open, so cancelling still has to work after a
  // click-away that no longer closes it.
  it('still restores the pre-edit filter when the box is escaped after a click away', async () => {
    const ctl = makeController();

    await ctl.beginFilter(DICTS);
    const first = lastInputBox();
    first.__type('Glo');
    await first.__accept();

    await ctl.beginFilter(DICTS);
    const second = lastInputBox();
    second.__type('Us');
    second.__clickAway();
    second.__hide(); // Escape

    expect(ctl.getFilter(DICTS)).toBe('Glo');
  });

  // A box open over another pane no longer gets out of the way by itself, so opening a second
  // one has to put the first away — as an accept, since asking to filter a second pane says
  // nothing about the first — and the newest box has to be the one a later commit closes.
  it('commits the open box when another pane starts filtering', async () => {
    const ctl = makeController();

    await ctl.beginFilter(CLASSES);
    const classes = lastInputBox();
    classes.__type('De');

    await ctl.beginFilter(DICTS);
    const dicts = lastInputBox();
    dicts.__type('Glo');
    ctl.commitFilterInput();

    expect(classes.hide).toHaveBeenCalled();
    expect(ctl.getFilter(CLASSES)).toBe('De');
    expect(dicts.hide).toHaveBeenCalled();
    expect(ctl.getFilter(DICTS)).toBe('Glo');
  });
});

describe('commitFilterOnRowSelection', () => {
  /** A pane stub that records its selection listener so a test can fire it. */
  function fakePane() {
    let listener: ((e: { selection: readonly unknown[] }) => void) | undefined;
    return {
      onDidChangeSelection: (h: (e: { selection: readonly unknown[] }) => void) => {
        listener = h;
        return { dispose: vi.fn() };
      },
      select: (node: unknown = { label: 'a row' }) => listener?.({ selection: [node] }),
      selectNothing: () => listener?.({ selection: [] }),
    };
  }

  it('commits the open filter box from a selection in any pane', () => {
    const ctl = { commitFilterInput: vi.fn() };
    const panes = [fakePane(), fakePane(), fakePane(), fakePane(), fakePane()];

    commitFilterOnRowSelection(ctl, ...panes);

    for (const [i, pane] of panes.entries()) {
      pane.select();
      expect(ctl.commitFilterInput).toHaveBeenCalledTimes(i + 1);
    }
  });

  // Typing in the box narrows the pane, which can take the selected row with it. VS Code
  // reports that as a selection change like any other, and closing the box the user is still
  // typing in would make the filter unusable a second way.
  it('leaves the box alone when filtering empties the pane selection', () => {
    const ctl = { commitFilterInput: vi.fn() };
    const pane = fakePane();

    commitFilterOnRowSelection(ctl, pane);
    pane.selectNothing();

    expect(ctl.commitFilterInput).not.toHaveBeenCalled();
  });

  // Clicking the "Filter:" row is how you edit an active filter — it runs the pane's filter
  // command. Committing on it would close the box that click just asked for (or, depending on
  // which of the two VS Code runs first, the one still open from before). The Methods pane's
  // chip runs that pane's button too — which now opens VS Code's find box, not ours.
  it('leaves the box alone when the row selected is the filter row itself', () => {
    const ctl = { commitFilterInput: vi.fn() };
    const pane = fakePane();

    commitFilterOnRowSelection(ctl, pane);
    pane.select(new FilterChipItem(DICTS, 'Glo'));

    expect(ctl.commitFilterInput).not.toHaveBeenCalled();
  });
});

// The wiring itself lives in registerGemStoneExplorer, which needs a live extension host to
// run — so guard it from the source, the way explorerViewRegistration.test.ts guards the pane
// ids. A pane that is created but never wired leaves the filter box hanging over it, and
// nothing else would notice.
describe('registerGemStoneExplorer', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'gemstoneExplorer.ts'), 'utf-8');

  it('commits the filter box from a row click in every pane it creates', () => {
    const created = [...src.matchAll(/const (\w+View) = vscode\.window\.createTreeView\(/g)].map(
      (m) => m[1],
    );
    expect(created).toHaveLength(5); // the Explorer's five panes

    const call = /commitFilterOnRowSelection\(\s*ctl,([^)]*)\)/.exec(src);
    const wired = (call?.[1] ?? '')
      .split(',')
      .map((arg) => arg.trim())
      .filter(Boolean);

    expect(wired.sort()).toEqual([...created].sort());
  });
});
