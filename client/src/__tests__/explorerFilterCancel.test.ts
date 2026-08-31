import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../browserQueries', () => ({
  getDictionaryNames: vi.fn(() => ['UserGlobals', 'Globals']),
}));

import * as vscode from '../__mocks__/vscode';
import { __resetConfig } from '../__mocks__/vscode';
import { ExplorerController } from '../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../sessionManager';

/**
 * The filter input's ACCEPT vs CANCEL contract (issue #388).
 *
 * `beginFilter` filters the pane live from `onDidChangeValue`, which is the behaviour worth
 * keeping — but that means every keystroke has already mutated the pane by the time the box
 * closes. Enter must keep what was typed; Escape must put back whatever was in effect when
 * the box opened, including a previously accepted filter the user was editing.
 *
 * These drive the real `beginFilter` through the mock InputBox rather than poking the private
 * filter map, because the accept/cancel distinction only exists in that flow: VS Code fires
 * onDidHide for BOTH Enter and Escape, and onDidAccept only for Enter.
 *
 * The pane under test is Dictionaries. Any of the panes still opening the input box would do —
 * the Methods pane would NOT: its button opens VS Code's own find box instead, which has no
 * accept/cancel of ours to get right (explorerMethodsFindBox.test.ts).
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

/** The filter currently applied to a pane. `getFilter` is public — the private-map casts
 *  elsewhere in these tests exist because there is no public SETTER, but reading has an API. */
function currentFilter(ctl: ExplorerController, viewId: string): string | undefined {
  return ctl.getFilter(viewId);
}

/** The InputBox `beginFilter` just created. */
interface MockInputBox {
  value: string;
  __type: (text: string) => void;
  __accept: () => Promise<void>;
  __hide: () => void;
}
function lastInputBox(): MockInputBox {
  // The accessor the mock's own doc comment advertises, so the two cannot drift.
  return vi.mocked(vscode.window.createInputBox).mock.results.at(-1)!.value;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetConfig();
});

describe('Explorer filter input: accept vs cancel', () => {
  it('filters the pane live as the user types', () => {
    const ctl = makeController();

    ctl.beginFilter(DICTS);
    lastInputBox().__type('Us');

    // The premise of the other tests: typing alone has already applied the filter.
    expect(currentFilter(ctl, DICTS)).toBe('Us');
  });

  it('keeps the typed filter when the user presses Enter', async () => {
    const ctl = makeController();

    ctl.beginFilter(DICTS);
    const box = lastInputBox();
    box.__type('Us');
    await box.__accept();

    expect(currentFilter(ctl, DICTS)).toBe('Us');
  });

  // The bug: Escape is offered as cancel, but only dismissed the box.
  it('discards the typed filter when the user presses Escape', () => {
    const ctl = makeController();

    ctl.beginFilter(DICTS);
    const box = lastInputBox();
    box.__type('Us');
    box.__hide(); // Escape

    expect(currentFilter(ctl, DICTS)).toBeUndefined();
  });

  // The worse case: the box opens seeded with the existing filter, so an abandoned edit
  // must restore the PREVIOUS filter rather than clearing it — otherwise Escape silently
  // destroys work the user had already accepted.
  it('restores the previously accepted filter when an edit is cancelled', async () => {
    const ctl = makeController();

    ctl.beginFilter(DICTS);
    const first = lastInputBox();
    first.__type('Glo');
    await first.__accept();
    expect(currentFilter(ctl, DICTS)).toBe('Glo');

    ctl.beginFilter(DICTS);
    const second = lastInputBox();
    expect(second.value).toBe('Glo'); // seeded with the accepted filter
    second.__type('Us');
    second.__hide(); // Escape

    expect(currentFilter(ctl, DICTS)).toBe('Glo');
  });

  // NB: this one passes even against the unfixed code — emptying the box already leaves the
  // filter cleared, so the bug happens to give the right answer here. It earns its place as a
  // guard on the FIX rather than the bug: a version that restored "the last non-empty value
  // typed" instead of the pre-edit value would fail it.
  it('cancels back to no filter even when the user emptied the box first', () => {
    const ctl = makeController();

    ctl.beginFilter(DICTS);
    const box = lastInputBox();
    box.__type('Us');
    box.__type(''); // clearing applies "no filter"…
    box.__hide(); // …and Escape must still land on the pre-edit state

    expect(currentFilter(ctl, DICTS)).toBeUndefined();
  });

  it('cancels only the pane being edited', async () => {
    const ctl = makeController();

    ctl.beginFilter(CLASSES);
    const classes = lastInputBox();
    classes.__type('Dem');
    await classes.__accept();

    ctl.beginFilter(DICTS);
    const dicts = lastInputBox();
    dicts.__type('Us');
    dicts.__hide(); // Escape on Dictionaries

    expect(currentFilter(ctl, DICTS)).toBeUndefined();
    expect(currentFilter(ctl, CLASSES)).toBe('Dem');
  });

  // Assert on the ROWS the provider actually returns, not just the filter map — the map entry is
  // the mechanism, the rendered rows are the behaviour the user sees.
  it('puts the unfiltered rows back on the pane when the user presses Escape', () => {
    const ctl = makeController();
    const rows = () => (ctl.dictProvider.getChildren() as { label?: string }[]).map((r) => r.label);
    const before = rows();
    expect(before).toEqual(expect.arrayContaining(['UserGlobals', 'Globals']));

    ctl.beginFilter(DICTS);
    const box = lastInputBox();
    box.__type('Glo');
    // The pane really did narrow, so the restore below is proving something.
    expect(rows()).not.toEqual(before);

    box.__hide(); // Escape

    expect(rows()).toEqual(before);
  });

  // Regression for the review finding: the restore used to write the pre-edit value back
  // unconditionally, so it could overwrite a filter someone else had set or cleared while the
  // box was open — the clear-filter command, a session change, or `selectClass`, which clears
  // the filter of the pane below it. (A class click now commits the box rather than cancelling it — see
  // explorerFilterClickAway.test.ts — so the guard is what covers the paths that aren't clicks.)
  it('does not resurrect its filter when something else changed the pane meanwhile', async () => {
    const ctl = makeController();

    ctl.beginFilter(DICTS);
    const first = lastInputBox();
    first.__type('Glo');
    await first.__accept();
    expect(currentFilter(ctl, DICTS)).toBe('Glo');

    ctl.beginFilter(DICTS);
    const second = lastInputBox();
    second.__type('Us');

    // Someone else takes ownership of this pane's filter while the box is still open.
    ctl.clearFilter(DICTS);
    expect(currentFilter(ctl, DICTS)).toBeUndefined();

    second.__hide(); // Escape

    expect(currentFilter(ctl, DICTS)).toBeUndefined();
  });

  // The other half of the guard: cancelling without typing should not churn the pane.
  it('does not touch the filter when the box is dismissed without an edit', () => {
    const ctl = makeController();
    const refreshed: string[] = [];
    const original = ctl.dictProvider.refresh.bind(ctl.dictProvider);
    vi.spyOn(ctl.dictProvider, 'refresh').mockImplementation(() => {
      refreshed.push('dicts');
      original();
    });

    ctl.beginFilter(DICTS);
    lastInputBox().__hide(); // Escape, nothing typed

    expect(currentFilter(ctl, DICTS)).toBeUndefined();
    expect(refreshed).toEqual([]);
  });
});
