import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import {
  ExplorerLanding,
  ExplorerNavigationHistory,
  MAX_LANDINGS,
  isMethodLanding,
  landingContext,
  landingKey,
  landingLabel,
  landingPath,
} from '../../explorerNavigationHistory';

// Landings in the shape the Explorer records them: a coordinate, not a handle.
const dict = (dictName = 'Globals'): ExplorerLanding => ({
  sessionId: 1,
  dictName,
  dictIndex: 1,
});
const category = (path: string): ExplorerLanding => ({ ...dict(), classCategory: path });
const klass = (className: string, classCategory?: string): ExplorerLanding => ({
  ...dict(),
  classCategory,
  className,
});
const method = (
  className: string,
  selector: string,
  opts: { isMeta?: boolean; classCategory?: string } = {},
): ExplorerLanding => ({
  ...klass(className, opts.classCategory),
  selector,
  isMeta: opts.isMeta ?? false,
});

/** The same coordinate read from a second logged-in session. */
const inSession = (landing: ExplorerLanding, sessionId: number): ExplorerLanding => ({
  ...landing,
  sessionId,
});

describe('ExplorerNavigationHistory', () => {
  let went: ExplorerLanding[];
  let reachable: boolean;
  let changes: number;
  let history: ExplorerNavigationHistory;

  beforeEach(() => {
    went = [];
    reachable = true;
    changes = 0;
    history = new ExplorerNavigationHistory({
      go: (landing) => {
        went.push(landing);
        // A real restore drives the panes, which record landings of their own;
        // replay that here so the suppression is actually exercised.
        if (reachable) {
          history.record(klass(landing.className ?? 'Unused', landing.classCategory));
          history.record(landing);
        }
        return Promise.resolve(reachable);
      },
      onChange: () => {
        changes++;
      },
    });
  });

  it('starts with nowhere to go', () => {
    expect(history.canGoBack()).toBe(false);
    expect(history.canGoForward()).toBe(false);
    expect(history.entries()).toEqual([]);
    expect(history.currentIndex()).toBe(-1);
  });

  it('does not record the place it is already showing twice', () => {
    history.record(method('Array', 'at:'));
    history.record(method('Array', 'at:'));
    expect(history.entries()).toHaveLength(1);
    expect(history.canGoBack()).toBe(false);
  });

  it('folds a method into the class landing it was reached through', () => {
    history.record(klass('Array', 'Collections'));
    history.record(method('Array', 'at:', { classCategory: 'Collections' }));
    expect(history.entries()).toHaveLength(1);
    expect(landingLabel(history.current()!)).toBe('Array>>at:');
  });

  it('folds a class into the dictionary landing it was reached through', () => {
    history.record(dict());
    history.record(klass('Array', 'Collections'));
    expect(history.entries()).toHaveLength(1);
    expect(landingLabel(history.current()!)).toBe('Array');
  });

  it('keeps separate entries for two methods of the same class', () => {
    history.record(method('Array', 'at:'));
    history.record(method('Array', 'at:put:'));
    expect(history.entries()).toHaveLength(2);
    expect(history.canGoBack()).toBe(true);
  });

  it('treats the instance and class sides of a selector as different places', () => {
    history.record(method('Array', 'new'));
    history.record(method('Array', 'new', { isMeta: true }));
    expect(history.entries()).toHaveLength(2);
    expect(landingLabel(history.current()!)).toBe('Array class>>new');
  });

  it('ignores a landing coarser than the one it is showing', () => {
    // Clicking a class category that still contains the selected class leaves the
    // user looking at the same method; it must not become a step of its own.
    history.record(method('Array', 'at:', { classCategory: 'Collections' }));
    history.record(klass('Array', 'Collections'));
    expect(history.entries()).toHaveLength(1);
    expect(landingLabel(history.current()!)).toBe('Array>>at:');
  });

  it('walks the whole chain one landing per press, then forward again', async () => {
    history.record(method('Array', 'at:'));
    history.record(method('Array', 'at:put:'));
    history.record(method('OrderedCollection', 'add:'));

    await history.back();
    expect(landingLabel(went[0])).toBe('Array>>at:put:');
    await history.back();
    expect(landingLabel(went[1])).toBe('Array>>at:');
    expect(history.canGoBack()).toBe(false);
    expect(history.canGoForward()).toBe(true);

    await history.forward();
    expect(landingLabel(went[2])).toBe('Array>>at:put:');
    await history.forward();
    expect(landingLabel(went[3])).toBe('OrderedCollection>>add:');
    expect(history.canGoForward()).toBe(false);
  });

  it('does not let the landings a restore provokes corrupt the chain', async () => {
    history.record(method('Array', 'at:'));
    history.record(method('OrderedCollection', 'add:'));
    await history.back();
    expect(history.entries()).toHaveLength(2);
    expect(history.currentIndex()).toBe(0);
    expect(history.canGoForward()).toBe(true);
  });

  it('discards the forward tail when a new landing happens after going back', async () => {
    history.record(method('Array', 'at:'));
    history.record(method('Array', 'at:put:'));
    await history.back();
    history.record(method('Set', 'add:'));

    expect(history.entries().map((l) => landingLabel(l))).toEqual(['Array>>at:', 'Set>>add:']);
    expect(history.canGoForward()).toBe(false);
  });

  it('drops the oldest landing once the ring is full', () => {
    for (let i = 0; i < MAX_LANDINGS + 5; i++) history.record(method('Array', `sel${i}`));
    expect(history.entries()).toHaveLength(MAX_LANDINGS);
    expect(landingLabel(history.entries()[0])).toBe('Array>>sel5');
    expect(history.currentIndex()).toBe(MAX_LANDINGS - 1);
  });

  it('drops a landing that no longer resolves and stays put, so a second press moves on', async () => {
    history.record(method('Array', 'gone'));
    history.record(method('Array', 'at:'));
    history.record(method('Set', 'add:'));
    reachable = false;

    await history.back();
    expect(history.entries().map((l) => landingLabel(l))).toEqual(['Array>>gone', 'Set>>add:']);
    expect(history.currentIndex()).toBe(1);
    expect(history.canGoBack()).toBe(true);
  });

  it('treats a throwing restore as unreachable rather than propagating', async () => {
    history.record(method('Array', 'at:'));
    history.record(method('Set', 'add:'));
    const boom = new ExplorerNavigationHistory({
      go: () => Promise.reject(new Error('stone went away')),
    });
    boom.record(method('Array', 'at:'));
    boom.record(method('Set', 'add:'));
    await expect(boom.back()).resolves.toBeUndefined();
    expect(boom.entries()).toHaveLength(1);
  });

  it('jumps straight to a landing picked out of the pane', async () => {
    history.record(method('Array', 'at:'));
    history.record(method('Array', 'at:put:'));
    history.record(method('Set', 'add:'));

    await history.goToIndex(0);
    expect(landingLabel(went[0])).toBe('Array>>at:');
    expect(history.currentIndex()).toBe(0);
    // A no-op for the entry already shown, and for an index off the end.
    await history.goToIndex(0);
    await history.goToIndex(99);
    expect(went).toHaveLength(1);
  });

  it('reports every move so the pane and the buttons can repaint', async () => {
    history.record(method('Array', 'at:'));
    history.record(method('Set', 'add:'));
    const afterRecords = changes;
    expect(afterRecords).toBeGreaterThanOrEqual(2);
    await history.back();
    expect(changes).toBeGreaterThan(afterRecords);
  });
});

describe('landingLabel', () => {
  it('names a dictionary, a category, a class and a method', () => {
    expect(landingLabel(dict())).toBe('Globals');
    expect(landingLabel(category('Collections'))).toBe('Globals · Collections');
    expect(landingLabel(klass('Array'))).toBe('Array');
    expect(landingLabel(method('Array', 'at:put:'))).toBe('Array>>at:put:');
    expect(landingLabel(method('Array', 'new', { isMeta: true }))).toBe('Array class>>new');
  });

  it('drops the class from a method when asked for selectors only', () => {
    expect(landingLabel(method('Array', 'at:put:'), 'selectors')).toBe('at:put:');
    expect(landingLabel(method('Array', 'new', { isMeta: true }), 'selectors')).toBe('new');
  });

  it('leaves landings with no method alone in either mode', () => {
    // There is nothing to shorten, so shortening must not blank them out.
    for (const mode of ['full', 'selectors'] as const) {
      expect(landingLabel(dict(), mode)).toBe('Globals');
      expect(landingLabel(category('Collections'), mode)).toBe('Globals · Collections');
      expect(landingLabel(klass('Array'), mode)).toBe('Array');
    }
  });
});

describe('landingContext', () => {
  it('is the dictionary when the label spells the location out', () => {
    expect(landingContext(method('Array', 'at:put:'))).toBe('Globals');
    expect(landingContext(klass('Array'))).toBe('Globals');
    expect(landingContext(dict())).toBe('Globals');
  });

  it('picks up the class the shortened label dropped', () => {
    expect(landingContext(method('Array', 'at:put:'), 'selectors')).toBe('Array');
    expect(landingContext(method('Array', 'new', { isMeta: true }), 'selectors')).toBe(
      'Array class',
    );
  });

  it('stays the dictionary for landings that never named a method', () => {
    expect(landingContext(klass('Array'), 'selectors')).toBe('Globals');
    expect(landingContext(category('Collections'), 'selectors')).toBe('Globals');
  });
});

describe('landingPath', () => {
  it('spells the whole coordinate out, for the places that have the width for it', () => {
    expect(landingPath(dict())).toBe('Globals');
    expect(landingPath(category('Collections'))).toBe('Globals · Collections');
    expect(landingPath(klass('Array', 'Collections'))).toBe('Globals · Collections · Array');
    expect(landingPath(method('Array', 'at:', { classCategory: 'Collections' }))).toBe(
      'Globals · Collections · Array>>at:',
    );
    expect(landingPath(method('Array', 'new', { isMeta: true }))).toBe(
      'Globals · Array class>>new',
    );
  });
});

describe('isMethodLanding', () => {
  it('is true only for a landing that reached a method', () => {
    expect(isMethodLanding(method('Array', 'at:'))).toBe(true);
    expect(isMethodLanding(klass('Array'))).toBe(false);
    expect(isMethodLanding(category('Collections'))).toBe(false);
    expect(isMethodLanding(dict())).toBe(false);
  });
});

// Browsing is reading methods; a dictionary or class you passed through on the way
// is not somewhere a press of Back should stop. The coarse landings stay in the
// chain — Recent Locations lists them — they just aren't steps.
describe('ExplorerNavigationHistory, over dictionaries and classes', () => {
  let history: ExplorerNavigationHistory;
  let went: ExplorerLanding[];

  beforeEach(() => {
    went = [];
    history = new ExplorerNavigationHistory({
      go: (landing) => {
        went.push(landing);
        return Promise.resolve(true);
      },
    });
  });

  it('keeps one entry, not two, when the user flips between dictionaries', () => {
    history.record(dict('Globals'));
    history.record(dict('Published'));
    history.record(dict('UserGlobals'));
    expect(history.entries().map((l) => landingLabel(l))).toEqual(['UserGlobals']);
  });

  it('replaces a class landing with the next class rather than stacking them', () => {
    history.record(klass('Array', 'Collections'));
    history.record(klass('Set', 'Collections'));
    expect(history.entries().map((l) => landingLabel(l))).toEqual(['Set']);
  });

  it('keeps the coarse landing in the chain when a method was recorded before it', () => {
    history.record(method('Array', 'at:'));
    history.record(dict('Published'));
    expect(history.entries().map((l) => landingLabel(l))).toEqual(['Array>>at:', 'Published']);
  });

  it('steps Back over a dictionary landing straight to the method before it', async () => {
    history.record(method('Array', 'at:'));
    history.record(dict('Published'));
    history.record(method('Set', 'add:'));
    // Globals · Set>>add: pushed a third entry, so the dictionary sits in the middle.
    expect(history.entries()).toHaveLength(3);

    await history.back();
    expect(landingLabel(went[0])).toBe('Array>>at:');
    expect(history.canGoBack()).toBe(false);

    await history.forward();
    expect(landingLabel(went[1])).toBe('Set>>add:');
  });

  it('lets Forward return to a trailing dictionary landing, so Back is undoable', async () => {
    history.record(method('Array', 'at:'));
    history.record(dict('Published'));
    expect(history.canGoBack()).toBe(true);

    await history.back();
    expect(landingLabel(went[0])).toBe('Array>>at:');
    expect(history.canGoForward()).toBe(true);

    await history.forward();
    expect(landingLabel(went[1])).toBe('Published');
  });

  it('still reaches a coarse landing mid-chain from Recent Locations', async () => {
    history.record(method('Array', 'at:'));
    history.record(dict('Published'));
    history.record(method('Set', 'add:'));
    await history.goToIndex(1);
    expect(landingLabel(went[0])).toBe('Published');
    expect(history.currentIndex()).toBe(1);
  });
});

// Our Back/Forward take over VS Code's keybindings wherever the Explorer or a
// gemstone:// editor has focus, so the two histories have to agree.
describe('ExplorerNavigationHistory, alongside VS Code’s own history', () => {
  let history: ExplorerNavigationHistory;
  let passed: string[];

  beforeEach(() => {
    passed = [];
    history = new ExplorerNavigationHistory({
      go: () => Promise.resolve(true),
      passThrough: (direction) => passed.push(direction),
    });
  });

  it('hands the press to VS Code when there is nothing of ours left that way', async () => {
    await history.back();
    await history.forward();
    expect(passed).toEqual(['back', 'forward']);

    history.record(method('Array', 'at:'));
    history.record(method('Set', 'add:'));
    passed = [];
    await history.back();
    expect(passed).toEqual([]);
    await history.back();
    expect(passed).toEqual(['back']);
  });

  it('moves the cursor with a native Back onto the entry before ours', () => {
    history.record(method('Array', 'at:'));
    history.record(method('Set', 'add:'));
    // VS Code reopened the earlier method's tab; the editor-focus sync reports it.
    history.record(method('Array', 'at:'), { fromEditor: true });
    expect(history.entries()).toHaveLength(2);
    expect(history.currentIndex()).toBe(0);
    expect(history.canGoForward()).toBe(true);
  });

  it('moves the cursor with a native Forward onto the entry after ours', async () => {
    history.record(method('Array', 'at:'));
    history.record(method('Set', 'add:'));
    await history.back();
    history.record(method('Set', 'add:'), { fromEditor: true });
    expect(history.entries()).toHaveLength(2);
    expect(history.currentIndex()).toBe(1);
  });

  it('moves the place forward when the same method is clicked in the tree', () => {
    history.record(method('Array', 'at:'));
    history.record(method('Set', 'add:'));
    history.record(method('Array', 'at:'));
    // A tree click is a fresh navigation, not the native history stepping onto a
    // neighbour: it lands at the END of the chain. It does not leave the earlier
    // visit behind as a second row.
    expect(history.entries().map((l) => landingLabel(l))).toEqual(['Set>>add:', 'Array>>at:']);
    expect(history.currentIndex()).toBe(1);
  });

  it('pushes an editor landing that is nowhere near the cursor', () => {
    history.record(method('Array', 'at:'));
    history.record(method('Set', 'add:'));
    history.record(method('Bag', 'do:'), { fromEditor: true });
    expect(history.entries()).toHaveLength(3);
    expect(history.currentIndex()).toBe(2);
  });
});

// A landing only means anything against the stone it was read from.
describe('ExplorerNavigationHistory, one chain per session', () => {
  let history: ExplorerNavigationHistory;
  let changes: number;

  beforeEach(() => {
    changes = 0;
    history = new ExplorerNavigationHistory({
      go: () => Promise.resolve(true),
      onChange: () => {
        changes++;
      },
    });
  });

  it('keeps each session’s landings to itself', () => {
    history.record(method('Array', 'at:'));
    history.record(inSession(method('Set', 'add:'), 2));
    expect(history.entries().map((l) => landingLabel(l))).toEqual(['Set>>add:']);

    history.setActiveSession(1);
    expect(history.entries().map((l) => landingLabel(l))).toEqual(['Array>>at:']);
    expect(history.currentIndex()).toBe(0);
  });

  it('shows an empty chain for a session that has not been anywhere', () => {
    history.record(method('Array', 'at:'));
    history.setActiveSession(7);
    expect(history.entries()).toEqual([]);
    expect(history.isEmpty()).toBe(true);
    expect(history.canGoBack()).toBe(false);
  });

  it('repaints when the shown session changes, and not when it does not', () => {
    history.record(method('Array', 'at:'));
    const before = changes;
    history.setActiveSession(1);
    expect(changes).toBe(before);
    history.setActiveSession(2);
    expect(changes).toBe(before + 1);
  });

  it('throws a session’s chain away when it logs out', () => {
    history.record(method('Array', 'at:'));
    history.dropSession(1);
    expect(history.entries()).toEqual([]);
    expect(history.isEmpty()).toBe(true);
    expect(history.currentSessionId()).toBeUndefined();
  });

  it('falls back to another logged-in session’s chain on a logout', () => {
    history.record(inSession(method('Bag', 'do:'), 2));
    history.record(method('Array', 'at:'));
    history.dropSession(1);
    expect(history.currentSessionId()).toBe(2);
    expect(history.entries().map((l) => landingLabel(l))).toEqual(['Bag>>do:']);
  });

  it('leaves the shown chain alone when a background session logs out', () => {
    history.record(inSession(method('Bag', 'do:'), 2));
    history.record(method('Array', 'at:'));
    history.dropSession(2);
    expect(history.currentSessionId()).toBe(1);
    expect(history.entries().map((l) => landingLabel(l))).toEqual(['Array>>at:']);
  });

  it('clears only the shown session’s chain', () => {
    history.record(inSession(method('Bag', 'do:'), 2));
    history.record(method('Array', 'at:'));
    history.clear();
    expect(history.entries()).toEqual([]);
    expect(history.isEmpty()).toBe(true);

    history.setActiveSession(2);
    expect(history.entries().map((l) => landingLabel(l))).toEqual(['Bag>>do:']);
  });

  it('records into a cleared chain again as if it were new', () => {
    history.record(method('Array', 'at:'));
    history.clear();
    history.record(method('Set', 'add:'));
    expect(history.entries().map((l) => landingLabel(l))).toEqual(['Set>>add:']);
    expect(history.currentIndex()).toBe(0);
  });
});

// A class has exactly one class category, and Back pins the category pane to it
// (revealClass) on the way to a method. So the same method carries a category when
// you walked back to it and none when you clicked it under "all classes" — and if
// that difference reached its identity, nothing would recognise the two as one
// place.
describe('a method is the same place however the panes got to it', () => {
  const uncategorised = method('GraphDemoOrder', 'printOn:');
  const categorised = method('GraphDemoOrder', 'printOn:', { classCategory: 'User Classes' });

  it('gives it one identity either way', () => {
    expect(landingKey(categorised)).toBe(landingKey(uncategorised));
  });

  it('still tells two categories of one dictionary apart', () => {
    // Where no class is named the category IS the place, so it has to count.
    expect(landingKey(category('User Classes'))).not.toBe(landingKey(category('SUnit')));
    expect(landingKey(category('User Classes'))).not.toBe(landingKey(dict()));
  });

  it('does not record it twice when the category pane caught up', () => {
    const history = new ExplorerNavigationHistory({ go: () => Promise.resolve(true) });
    history.record(uncategorised);
    history.record(categorised);
    expect(history.entries()).toHaveLength(1);
  });

  it('lets VS Code’s Back step onto it rather than appending a duplicate', () => {
    const history = new ExplorerNavigationHistory({ go: () => Promise.resolve(true) });
    history.record(uncategorised);
    history.record(method('GraphDemoOrder', 'addItem:'));
    history.record(categorised, { fromEditor: true });
    expect(history.entries()).toHaveLength(2);
    expect(history.currentIndex()).toBe(0);
  });
});

// The list the pane draws is not the Back/Forward chain. Going Back and then
// opening something else discards what was ahead *of the chain* — that is what
// keeps Back predictable — but nothing may vanish from the list, and no method may
// appear in it twice.
// The trail is the chain, and the chain is a browser's: going somewhere new after
// pressing Back discards what was ahead. What it must NOT do is list one method
// twice — walking around a class comes back to the same methods constantly, and a
// trail full of repeats is a trail you stop reading.
describe('the chain lists a place once, at its most recent visit', () => {
  let history: ExplorerNavigationHistory;
  let went: ExplorerLanding[];

  beforeEach(() => {
    went = [];
    history = new ExplorerNavigationHistory({
      go: (landing) => {
        went.push(landing);
        return Promise.resolve(true);
      },
    });
  });

  const listed = (): string[] => history.entries().map((l) => landingLabel(l));

  it('moves a method you return to rather than listing it twice', () => {
    history.record(method('Array', 'at:'));
    history.record(method('Set', 'add:'));
    history.record(method('Array', 'at:'));
    expect(listed()).toEqual(['Set>>add:', 'Array>>at:']);
    expect(history.currentIndex()).toBe(1);
  });

  it('still discards what was ahead when you go back and open something else', async () => {
    history.record(method('GraphDemoOrder', 'addItem:'));
    history.record(method('GraphDemoOrder', 'customer'));
    history.record(method('GraphDemoOrder', 'lineItems'));
    await history.back();
    await history.back();
    history.record(method('GraphDemoOrder', 'printOn:'));

    expect(listed()).toEqual(['GraphDemoOrder>>addItem:', 'GraphDemoOrder>>printOn:']);
    expect(history.canGoForward()).toBe(false);
  });

  it('keeps Back walking backwards after a place has moved', async () => {
    history.record(method('Array', 'at:'));
    history.record(method('Set', 'add:'));
    history.record(method('Bag', 'do:'));
    history.record(method('Set', 'add:')); // back to one we read earlier

    expect(listed()).toEqual(['Array>>at:', 'Bag>>do:', 'Set>>add:']);
    await history.back();
    expect(landingLabel(history.current()!)).toBe('Bag>>do:');
    await history.back();
    expect(landingLabel(history.current()!)).toBe('Array>>at:');
    expect(history.canGoBack()).toBe(false);
  });

  it('does not fold two methods of one class together', () => {
    // The de-duplication is by place, not by class — the guard against it folding
    // a whole class into one row.
    history.record(method('Array', 'at:'));
    history.record(method('Array', 'at:put:'));
    history.record(method('Array', 'new', { isMeta: true }));
    expect(listed()).toEqual(['Array>>at:', 'Array>>at:put:', 'Array class>>new']);
  });

  it('counts a drill-down as the one place it reached', () => {
    history.record(dict());
    history.record(klass('Array', 'Collections'));
    history.record(method('Array', 'at:', { classCategory: 'Collections' }));
    expect(listed()).toEqual(['Array>>at:']);
  });

  it('is what Clear empties, and what says whether there is anything to clear', () => {
    expect(history.isEmpty()).toBe(true);
    history.record(method('Array', 'at:'));
    expect(history.isEmpty()).toBe(false);
    history.clear();
    expect(history.entries()).toEqual([]);
    expect(history.isEmpty()).toBe(true);
  });
});
