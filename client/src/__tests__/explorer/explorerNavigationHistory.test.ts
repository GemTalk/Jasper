import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import {
  ExplorerLanding,
  ExplorerNavigationHistory,
  MAX_LANDINGS,
  landingContext,
  landingLabel,
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

describe('ExplorerNavigationHistory', () => {
  let visited: ExplorerLanding[];
  let reachable: boolean;
  let changes: number;
  let history: ExplorerNavigationHistory;

  beforeEach(() => {
    visited = [];
    reachable = true;
    changes = 0;
    history = new ExplorerNavigationHistory({
      go: (landing) => {
        visited.push(landing);
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
    expect(landingLabel(visited[0])).toBe('Array>>at:put:');
    await history.back();
    expect(landingLabel(visited[1])).toBe('Array>>at:');
    expect(history.canGoBack()).toBe(false);
    expect(history.canGoForward()).toBe(true);

    await history.forward();
    expect(landingLabel(visited[2])).toBe('Array>>at:put:');
    await history.forward();
    expect(landingLabel(visited[3])).toBe('OrderedCollection>>add:');
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
    expect(landingLabel(visited[0])).toBe('Array>>at:');
    expect(history.currentIndex()).toBe(0);
    // A no-op for the entry already shown, and for an index off the end.
    await history.goToIndex(0);
    await history.goToIndex(99);
    expect(visited).toHaveLength(1);
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
