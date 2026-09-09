import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getDictionaryNames: vi.fn(() => ['UserGlobals', 'Globals']),
}));

import { ClassItem, HierarchyItem, ExplorerController } from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import type { ClassVersionInfo } from '../../refactoring/queries/getClassVersions';

// A class with more than one version in its class history carries the count on its
// row. Bare `[3/3]` said nothing about WHAT was being counted — methods, subclasses,
// variables were all as good a guess — and the row's hover repeated the label, so
// there was nowhere to find out. The `v` marks it as a version and the tooltip spells
// it out. Both panes that render the tag are pinned here, because they format it
// through the same two helpers and the whole point is that they cannot drift.

function makeController(): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'Globals';
  ctl.state.dictIndex = 2;
  return ctl;
}

function setVersions(ctl: ExplorerController, entries: [string, ClassVersionInfo][]): void {
  (ctl as unknown as { classVersions: Map<string, ClassVersionInfo> }).classVersions = new Map(
    entries,
  );
}

describe('the class-history version tag on a Classes pane row', () => {
  it('marks the numbers as a version with a leading v', () => {
    const item = new ClassItem('Foo', false, { current: 3, total: 3 });
    expect(item.label).toBe('Foo[v3/3]');
  });

  it('says what the numbers mean in the tooltip, rather than repeating the label', () => {
    const item = new ClassItem('Foo', false, { current: 2, total: 3 });
    expect(item.tooltip).toBe('Foo — version 2 of 3');
    expect(item.tooltip).not.toBe(item.label);
  });

  it('leaves a single-version class a plain name, in label and tooltip alike', () => {
    const item = new ClassItem('Foo');
    expect(item.label).toBe('Foo');
    expect(item.tooltip).toBe('Foo');
  });

  // The tag is display only: the id is what reveal() and the ivar sub-tree match on,
  // so a class gaining a version must not become a different node.
  it('keeps the row identity on the raw class name', () => {
    expect(new ClassItem('Foo', false, { current: 2, total: 3 }).id).toBe(new ClassItem('Foo').id);
  });
});

describe('the same tag in the Class Hierarchy pane', () => {
  it('formats the label and the tooltip exactly as the Classes pane does', () => {
    const hier = new HierarchyItem('Foo', 'Globals', 'self', 0, false, { current: 2, total: 3 });
    const klass = new ClassItem('Foo', false, { current: 2, total: 3 });
    expect(hier.label).toBe(klass.label);
    expect(hier.tooltip).toBe(klass.tooltip);
  });

  it('leaves a single-version class untagged there too', () => {
    const hier = new HierarchyItem('Foo', 'Globals', 'subclass', -1, false);
    expect(hier.label).toBe('Foo');
    expect(hier.tooltip).toBe('Foo');
  });
});

describe('what the controller hands the rows', () => {
  it('gives the row the position itself, so the row owns the wording', () => {
    const ctl = makeController();
    setVersions(ctl, [['Foo', { current: 2, total: 3 }]]);
    expect(ctl.classVersion('Foo')).toEqual({ current: 2, total: 3 });
  });

  it('answers undefined for a class with one version, which renders untagged', () => {
    const ctl = makeController();
    setVersions(ctl, []);
    expect(ctl.classVersion('Foo')).toBeUndefined();
    expect(new ClassItem('Foo', false, ctl.classVersion('Foo')).label).toBe('Foo');
  });
});
