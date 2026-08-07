import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../browserQueries', () => ({}));

import * as vscode from '../__mocks__/vscode';
import { __setConfig, __resetConfig } from '../__mocks__/vscode';
import { ExplorerController } from '../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../sessionManager';
import type { EnvCategoryLine } from '../browserQueries';

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
 */

const METHODS = 'gemstoneExplorerMethods';
const CLASSES = 'gemstoneExplorerClasses';

function makeController(): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.className = 'Demo';
  ctl.state.dictIndex = 1;
  (ctl as unknown as { envLines: EnvCategoryLine[] }).envLines = [
    { isMeta: false, envId: 0, category: 'accessing', selectors: ['at:', 'size'] },
  ];
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

    ctl.beginFilter(METHODS);
    lastInputBox().__type('at');

    // The premise of the other tests: typing alone has already applied the filter.
    expect(currentFilter(ctl, METHODS)).toBe('at');
  });

  it('keeps the typed filter when the user presses Enter', async () => {
    const ctl = makeController();

    ctl.beginFilter(METHODS);
    const box = lastInputBox();
    box.__type('at');
    await box.__accept();

    expect(currentFilter(ctl, METHODS)).toBe('at');
  });

  // The bug: Escape is offered as cancel, but only dismissed the box.
  it('discards the typed filter when the user presses Escape', () => {
    const ctl = makeController();

    ctl.beginFilter(METHODS);
    const box = lastInputBox();
    box.__type('at');
    box.__hide(); // Escape

    expect(currentFilter(ctl, METHODS)).toBeUndefined();
  });

  // The worse case: the box opens seeded with the existing filter, so an abandoned edit
  // must restore the PREVIOUS filter rather than clearing it — otherwise Escape silently
  // destroys work the user had already accepted.
  it('restores the previously accepted filter when an edit is cancelled', async () => {
    const ctl = makeController();

    ctl.beginFilter(METHODS);
    const first = lastInputBox();
    first.__type('size');
    await first.__accept();
    expect(currentFilter(ctl, METHODS)).toBe('size');

    ctl.beginFilter(METHODS);
    const second = lastInputBox();
    expect(second.value).toBe('size'); // seeded with the accepted filter
    second.__type('at');
    second.__hide(); // Escape

    expect(currentFilter(ctl, METHODS)).toBe('size');
  });

  // NB: this one passes even against the unfixed code — emptying the box already leaves the
  // filter cleared, so the bug happens to give the right answer here. It earns its place as a
  // guard on the FIX rather than the bug: a version that restored "the last non-empty value
  // typed" instead of the pre-edit value would fail it.
  it('cancels back to no filter even when the user emptied the box first', () => {
    const ctl = makeController();

    ctl.beginFilter(METHODS);
    const box = lastInputBox();
    box.__type('at');
    box.__type(''); // clearing applies "no filter"…
    box.__hide(); // …and Escape must still land on the pre-edit state

    expect(currentFilter(ctl, METHODS)).toBeUndefined();
  });

  it('cancels only the pane being edited', async () => {
    const ctl = makeController();

    ctl.beginFilter(CLASSES);
    const classes = lastInputBox();
    classes.__type('Dem');
    await classes.__accept();

    ctl.beginFilter(METHODS);
    const methods = lastInputBox();
    methods.__type('at');
    methods.__hide(); // Escape on Methods

    expect(currentFilter(ctl, METHODS)).toBeUndefined();
    expect(currentFilter(ctl, CLASSES)).toBe('Dem');
  });

  // Assert on the ROWS the provider actually returns, not just the filter map — the map entry is
  // the mechanism, the rendered rows are the behaviour the user sees.
  it('puts the unfiltered rows back on the pane when the user presses Escape', () => {
    // Flat (ungrouped) view, so the provider's top level is the selectors themselves rather
    // than the category nodes.
    __setConfig('gemstone', 'explorer.groupMethodsByCategory', false);
    const ctl = makeController();
    const selectors = () =>
      (ctl.methodProvider.getChildren() as { label?: string }[]).map((r) => r.label);
    const before = selectors();
    expect(before).toEqual(expect.arrayContaining(['at:', 'size']));

    ctl.beginFilter(METHODS);
    const box = lastInputBox();
    box.__type('si');
    // The pane really did narrow, so the restore below is proving something.
    expect(selectors()).not.toEqual(before);

    box.__hide(); // Escape

    expect(selectors()).toEqual(before);
  });

  // Regression for the review finding: the restore used to write the pre-edit value back
  // unconditionally. Selecting a class clears the Methods filter (`selectClass` ->
  // `clearFilters(VIEW_METHODS)`), and that same click dismisses an open box — so an
  // unconditional restore re-applied the PREVIOUS class's filter onto the newly selected one.
  it('does not resurrect its filter when something else changed the pane meanwhile', async () => {
    const ctl = makeController();

    ctl.beginFilter(METHODS);
    const first = lastInputBox();
    first.__type('size');
    await first.__accept();
    expect(currentFilter(ctl, METHODS)).toBe('size');

    ctl.beginFilter(METHODS);
    const second = lastInputBox();
    second.__type('at');

    // Someone else takes ownership of this pane's filter while the box is still open.
    ctl.clearFilter(METHODS);
    expect(currentFilter(ctl, METHODS)).toBeUndefined();

    second.__hide(); // Escape

    expect(currentFilter(ctl, METHODS)).toBeUndefined();
  });

  // The other half of the guard: cancelling without typing should not churn the pane.
  it('does not touch the filter when the box is dismissed without an edit', () => {
    const ctl = makeController();
    const refreshed: string[] = [];
    const original = ctl.methodProvider.refresh.bind(ctl.methodProvider);
    vi.spyOn(ctl.methodProvider, 'refresh').mockImplementation(() => {
      refreshed.push('methods');
      original();
    });

    ctl.beginFilter(METHODS);
    lastInputBox().__hide(); // Escape, nothing typed

    expect(currentFilter(ctl, METHODS)).toBeUndefined();
    expect(refreshed).toEqual([]);
  });
});
