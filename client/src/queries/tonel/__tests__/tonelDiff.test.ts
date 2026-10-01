// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../tonelCapability` for the full statement.
//
// Tests for the churn tests' diff. The case that earns its keep is
// `reports a moved line as a removal and an addition`: a set-difference
// implementation passes every other case here and fails only that one, while
// silently blessing exactly the reordering churn the suite exists to catch.
import { describe, it, expect } from 'vitest';

import { diffLines, added, removed, meaningful } from './tonelDiff';

describe('diffLines', () => {
  it('reports nothing for identical text', () => {
    expect(diffLines('a\nb\nc', 'a\nb\nc')).toEqual([]);
  });

  it('reports an inserted line as a single addition', () => {
    const changes = diffLines('a\nc', 'a\nb\nc');
    expect(added(changes)).toEqual(['b']);
    expect(removed(changes)).toEqual([]);
  });

  it('reports a deleted line as a single removal', () => {
    const changes = diffLines('a\nb\nc', 'a\nc');
    expect(removed(changes)).toEqual(['b']);
    expect(added(changes)).toEqual([]);
  });

  it('reports a changed line as one removal and one addition', () => {
    const changes = diffLines('a\nb\nc', 'a\nB\nc');
    expect(removed(changes)).toEqual(['b']);
    expect(added(changes)).toEqual(['B']);
  });

  it('reports a moved line as a removal and an addition', () => {
    // The whole reason this is an LCS diff. A set difference answers "no change"
    // here, which would bless the exact churn the suite is meant to catch.
    const changes = diffLines('a\nb\nc', 'b\na\nc');
    expect(changes.length).toBeGreaterThan(0);
    expect(added(changes)).not.toEqual([]);
    expect(removed(changes)).not.toEqual([]);
  });

  it('drops blank-only lines from the meaningful changes', () => {
    const changes = diffLines('a\nc', 'a\n\nb\nc');
    expect(meaningful(changes).map((c) => c.line)).toEqual(['b']);
  });
});
