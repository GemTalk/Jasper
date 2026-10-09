// The hierarchy queries against a live stone, through the session's cached ClassOrganizer.
//
// GemStone's `ClassOrganizer >> subclassesOf:` answers from a table that only has entries for
// classes WITH subclasses. Asked about any other class it calls `addClass:` -- even for a class it
// already holds -- and `addClass:` drops every class of the same name, on the assumption that a
// same-named class is an older version of the one being added. Two different classes of one name,
// in two dictionaries under one superclass, are not versions: asking about one silently removes the
// other from the cached organizer, so every later query reads a hierarchy with a class missing.
// `allSuperclassesOf:` does the same for a class the organizer does not hold.
//
// The first block pins that case. The second pins the ordinary cases -- distinct names, a class
// defined after the organizer was built, a new version of a class -- where the queries must answer
// what GemStone's own `subclassesOf:` does. The third keeps the two from drifting apart: the
// workaround re-implements GemStone's lookups, so it is checked against them across the whole
// image, and the kernel bug it works around is pinned so a release that fixes it says so.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import { defaultQueryExecutorUsing } from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import type { QueryExecutor } from '../types';
import {
  clearClassOrganizerStatement,
  subclassesOfBlock,
  superclassesOfBlock,
} from '../classOrganizer';
import { getClassHierarchy } from '../getClassHierarchy';
import { getClassDescendantNames } from '../../refactoring/queries/getClassDescendantNames';
import { getSiblingClassNames } from '../../refactoring/queries/getSiblingClassNames';

const subclassRows = (exec: QueryExecutor, cls: string, dict: number) =>
  getClassHierarchy(exec, cls, dict)
    .filter((e) => e.kind === 'subclass')
    .map((e) => `${e.className}@${e.dictIndex ?? 0}`);

const descendantRows = (exec: QueryExecutor, cls: string, dict: number) =>
  getClassDescendantNames(exec, cls, dict).map((d) => `${d.className}@${d.dictIndex}`);

/** Adds fresh dictionaries of the given names to the symbol list (rolled back by the harness's abort) and
 *  answers their 1-based positions. */
const addDictionaries = (exec: QueryExecutor, names: string[]): number[] =>
  exec(
    `| sl out |
sl := System myUserProfile symbolList.
out := WriteStream on: String new.
#(${names.map((n) => `#${n}`).join(' ')}) do: [:n |
  sl add: (SymbolDictionary new name: n; yourself).
  out print: sl size; space].
out contents`,
  )
    .trim()
    .split(/\s+/)
    .map(Number);

const defineIn = (
  exec: QueryExecutor,
  superclass: string,
  name: string,
  dict: number,
  ivars = '',
) =>
  exec(
    `(${superclass}) subclass: '${name}' instVarNames: #(${ivars}) classVars: #() classInstVars: #() ` +
      `poolDictionaries: #() inDictionary: (System myUserProfile symbolList at: ${dict}). 'ok'`,
  );

const at = (dict: number, name: string) =>
  `(System myUserProfile symbolList at: ${dict}) at: #${name}`;

describe('hierarchy queries with two same-named classes under one superclass (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });
  const exec = (): QueryExecutor =>
    defaultQueryExecutorUsing({ id: 1, gci, handle } as unknown as ActiveSession);

  // OrgTwinBase (dict A) with three subclasses: OrgTwinLeaf in A, OrgTwinLeaf in B, OrgTwinOther in A.
  let a = 0;
  let b = 0;
  const fixture = (): void => {
    exec()(`${clearClassOrganizerStatement()}\n'ok'`);
    [a, b] = addDictionaries(exec(), ['OrgTwinDictA', 'OrgTwinDictB']);
    defineIn(exec(), 'Object', 'OrgTwinBase', a);
    defineIn(exec(), at(a, 'OrgTwinBase'), 'OrgTwinLeaf', a);
    defineIn(exec(), at(a, 'OrgTwinBase'), 'OrgTwinLeaf', b);
    defineIn(exec(), at(a, 'OrgTwinBase'), 'OrgTwinOther', a);
  };
  const bothLeavesAndOther = () =>
    [`OrgTwinLeaf@${a}`, `OrgTwinLeaf@${b}`, `OrgTwinOther@${a}`].sort();

  it('lists both same-named subclasses every time the descendants are asked for', () => {
    fixture();

    const first = descendantRows(exec(), 'OrgTwinBase', a).sort();
    const second = descendantRows(exec(), 'OrgTwinBase', a).sort();

    expect(first).toEqual(bothLeavesAndOther());
    expect(second).toEqual(first);
  });

  it('still lists both after the hierarchy of one of them was shown', () => {
    fixture();
    getClassHierarchy(exec(), 'OrgTwinLeaf', b);

    expect(descendantRows(exec(), 'OrgTwinBase', a).sort()).toEqual(bothLeavesAndOther());
  });

  it('shows both in the superclass’s hierarchy after the descendants were walked', () => {
    fixture();
    descendantRows(exec(), 'OrgTwinBase', a);

    expect(subclassRows(exec(), 'OrgTwinBase', a).sort()).toEqual(bothLeavesAndOther());
  });

  it('offers both as siblings after the hierarchy of one of them was shown', () => {
    fixture();
    getClassHierarchy(exec(), 'OrgTwinLeaf', a);

    expect(getSiblingClassNames(exec(), 'OrgTwinOther', a)).toEqual(['OrgTwinLeaf', 'OrgTwinLeaf']);
  });

  it('keeps both when a third class of that name appears after the organizer was built', () => {
    // Not a new version of either: a different class that shares the name. The organizer may not
    // learn it until it is rebuilt, but it must not forget the two it already had.
    fixture();
    descendantRows(exec(), 'OrgTwinBase', a);
    const [c] = addDictionaries(exec(), ['OrgTwinDictC']);
    defineIn(exec(), at(a, 'OrgTwinBase'), 'OrgTwinLeaf', c);
    getClassHierarchy(exec(), 'OrgTwinLeaf', c);

    expect(descendantRows(exec(), 'OrgTwinBase', a)).toEqual(
      expect.arrayContaining([`OrgTwinLeaf@${a}`, `OrgTwinLeaf@${b}`]),
    );
  });

  it('shows a new version’s subclasses though a different class shares its name', () => {
    // A refactoring gives the class a new version and re-points its subclasses at it, after the
    // organizer was built. Another class of the same name (in dictionary B, under the first) is a
    // different class, not a version -- it must not stop the new version's subclasses showing.
    fixture();
    defineIn(exec(), at(a, 'OrgTwinBase'), 'OrgTwinBase', b);
    descendantRows(exec(), 'OrgTwinBase', a);
    defineIn(exec(), 'Object', 'OrgTwinBase', a, "'added'");
    defineIn(exec(), at(a, 'OrgTwinBase'), 'OrgTwinOther', a);

    expect(subclassRows(exec(), 'OrgTwinBase', a)).toEqual([`OrgTwinOther@${a}`]);
  });
});

describe('hierarchy queries over ordinary hierarchies (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });
  const exec = (): QueryExecutor =>
    defaultQueryExecutorUsing({ id: 1, gci, handle } as unknown as ActiveSession);

  // OrgPlainBase -> OrgPlainA -> OrgPlainA1, OrgPlainBase -> OrgPlainB, all in one dictionary.
  let d = 0;
  const fixture = (): void => {
    exec()(`${clearClassOrganizerStatement()}\n'ok'`);
    [d] = addDictionaries(exec(), ['OrgPlainDict']);
    defineIn(exec(), 'Object', 'OrgPlainBase', d);
    defineIn(exec(), at(d, 'OrgPlainBase'), 'OrgPlainA', d);
    defineIn(exec(), at(d, 'OrgPlainBase'), 'OrgPlainB', d);
    defineIn(exec(), at(d, 'OrgPlainA'), 'OrgPlainA1', d);
  };

  it('walks the descendants top-down, each level sorted by name', () => {
    fixture();

    expect(getClassDescendantNames(exec(), 'OrgPlainBase', d)).toEqual([
      expect.objectContaining({ className: 'OrgPlainA', parentName: 'OrgPlainBase' }),
      expect.objectContaining({ className: 'OrgPlainB', parentName: 'OrgPlainBase' }),
      expect.objectContaining({ className: 'OrgPlainA1', parentName: 'OrgPlainA' }),
    ]);
  });

  it('answers the same descendants when asked again', () => {
    fixture();
    const first = descendantRows(exec(), 'OrgPlainBase', d);

    expect(descendantRows(exec(), 'OrgPlainBase', d)).toEqual(first);
  });

  it('shows a class’s superclasses root-first and its direct subclasses only', () => {
    fixture();

    const rows = getClassHierarchy(exec(), 'OrgPlainA', d).map((e) => `${e.kind}:${e.className}`);

    expect(rows).toEqual([
      'superclass:Object',
      'superclass:OrgPlainBase',
      'self:OrgPlainA',
      'subclass:OrgPlainA1',
    ]);
  });

  it('shows no subclasses for a class that has none', () => {
    fixture();

    expect(subclassRows(exec(), 'OrgPlainA1', d)).toEqual([]);
  });

  it('offers the other subclasses of the same superclass as siblings', () => {
    fixture();

    expect(getSiblingClassNames(exec(), 'OrgPlainA', d)).toEqual(['OrgPlainB']);
  });

  it('learns a class defined after the organizer was built once that class is shown', () => {
    // GemStone's subclassesOf: adds a class it has not seen; showing the new class must still teach
    // the cached organizer about it, so its superclass then lists it.
    fixture();
    descendantRows(exec(), 'OrgPlainBase', d);
    defineIn(exec(), at(d, 'OrgPlainBase'), 'OrgPlainLate', d);
    getClassHierarchy(exec(), 'OrgPlainLate', d);

    expect(subclassRows(exec(), 'OrgPlainBase', d)).toEqual([
      `OrgPlainA@${d}`,
      `OrgPlainB@${d}`,
      `OrgPlainLate@${d}`,
    ]);
  });

  it('replaces the old version with the new one when a class is redefined', () => {
    // A redefinition makes a new version with the same name and class history. Showing it must
    // swap it in for the old version, as GemStone does -- not list both.
    fixture();
    descendantRows(exec(), 'OrgPlainBase', d);
    defineIn(exec(), at(d, 'OrgPlainBase'), 'OrgPlainB', d, "'extra'");
    getClassHierarchy(exec(), 'OrgPlainB', d);

    expect(subclassRows(exec(), 'OrgPlainBase', d)).toEqual([`OrgPlainA@${d}`, `OrgPlainB@${d}`]);
  });
});

describe('the workaround against GemStone’s own ClassOrganizer lookups (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });
  const exec = (): QueryExecutor =>
    defaultQueryExecutorUsing({ id: 1, gci, handle } as unknown as ActiveSession);

  it('answers what GemStone answers for every class in the image', () => {
    // The base image has no two same-named classes under one superclass, so GemStone's lookups
    // are right here and serve as the reference. Each side gets its own organizer: GemStone's
    // lookups change theirs as they go, ours must not. Answers only the classes that differ.
    const code = `| gs ours subsOf supersOf same out |
gs := ClassOrganizer newForEnvironment: 0.
ours := ClassOrganizer newForEnvironment: 0.
subsOf := ${subclassesOfBlock('ours')}.
supersOf := ${superclassesOfBlock('ours')}.
same := [:x :y | x size = y size and: [(x detect: [:e | (y includesIdentical: e) not] ifNone: [nil]) isNil]].
out := WriteStream on: String new.
gs classes asArray do: [:each |
  (same value: (gs subclassesOf: each) value: (subsOf value: each))
    ifFalse: [out nextPutAll: each name; nextPutAll: ' subclasses'; lf].
  ((gs allSuperclassesOf: each) asArray = (supersOf value: each) asArray)
    ifFalse: [out nextPutAll: each name; nextPutAll: ' superclasses'; lf]].
out contents`;

    const differences = exec()(code)
      .split('\n')
      .filter((l) => l.length > 0);

    expect(differences).toEqual([]);
  });

  it('still finds GemStone’s own lookup losing a same-named class', () => {
    // The reason the workaround exists. When this fails, GemStone's subclassesOf: no longer
    // drops a same-named sibling, and subclassesOfBlock / superclassesOfBlock can go back to
    // asking the organizer directly.
    const [a, b] = addDictionaries(exec(), ['OrgKernelDictA', 'OrgKernelDictB']);
    defineIn(exec(), 'Object', 'OrgKernelBase', a);
    defineIn(exec(), at(a, 'OrgKernelBase'), 'OrgKernelLeaf', a);
    defineIn(exec(), at(a, 'OrgKernelBase'), 'OrgKernelLeaf', b);

    const counts = exec()(`| org base before after |
base := ${at(a, 'OrgKernelBase')}.
org := ClassOrganizer newForEnvironment: 0.
before := (org subclassesOf: base) size.
org subclassesOf: (${at(b, 'OrgKernelLeaf')}).
after := (org subclassesOf: base) size.
before printString, ' ', after printString`);

    expect(counts).toBe('2 1');
  });
});
