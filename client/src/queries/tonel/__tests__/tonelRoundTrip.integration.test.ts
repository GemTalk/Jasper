// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../tonelCapability` for the full statement. SKIPS on anything else.
//
// File out and file in, against each other, on a live stone.
//
// The shape is a TEXT FIXPOINT rather than a field-by-field comparison:
//
//     t1  = fileOut(C)
//     t1' = t1 with the class renamed
//           file t1' in
//     t2  = fileOut(<the copy>)
//     assert t2 == t1'
//
// One string comparison proves the whole round trip at once — superclass,
// instance/class/class-instance variables, comment, every method's protocol,
// every method's source, and the method ORDER. A field-by-field check would have
// to remember to assert each of those, and would silently not cover whatever it
// forgot. There is precedent in this repo: `rowanExportFixpoint.integration.test.ts`
// proves Rowan project export the same way.
//
// The copy is filed in under a DIFFERENT NAME, never over the original. That is
// not tidiness: file in REPLACES, so filing a class back onto itself would clear
// its methods first, and on a base-image class that is destructive.
//
// It is destructive in a way this suite could actually cause, which is the point.
// `canBeWritten` is an AUTHORIZATION answer, not a property of the class: measured
// on a 3.7.5 rowan3 stone, all 1127 classes in `Globals` answer true as SystemUser
// and none of them do as DataCurator. This tier runs as DataCurator (see
// useRowan3Stone.ts on why that is load-bearing), so today the write would be
// refused — but a developer running the same code as SystemUser, which is the
// ordinary way to work on base code, would succeed. The different name is what
// makes the suite safe under either login, so do not relax it on the grounds that
// the write "cannot" land.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../../gciLibrary';
import * as q from '../../../browserQueries';
import type { ActiveSession } from '../../../sessionManager';
import { fileOutClassTonel } from '../fileOutClassTonel';
import { isTonelFileOutError } from '../rowanLookup';
import { readTonelClass } from '../readTonelClass';
import { applyTonelClass } from '../../../fileTransfer/tonelFileIn';
import { declarationSequenceOf, duplicateDeclarationsOf } from './tonelOracles';
import { useRowan3Stone } from './useRowan3Stone';

const SOURCE = 'JasperRoundTripSource';
const COPY = 'JasperRoundTripCopy';

describe('tonel round trip (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);
  const rowan3 = useRowan3Stone(() => exec);

  /** A class with both sides, several protocols, and variables of every kind. */
  const defineSource = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${SOURCE}' instVarNames: #('size' 'colour') ` +
        `classVars: #('Registry') classInstVars: #('Count') poolDictionaries: #() ` +
        `inDictionary: UserGlobals`,
    );
    q.setClassComment(session(), SOURCE, 'A round-trip probe.\nSecond line.');
    for (const [category, source] of [
      ['accessing', 'colour\n\t^colour'],
      ['accessing', 'size\n\t^size'],
      ['accessing', 'size: aValue\n\tsize := aValue'],
      ['printing', "printOn: aStream\n\taStream nextPutAll: 'probe'"],
      ['private', '_reset\n\tsize := nil'],
    ] as const) {
      q.compileMethod(session(), SOURCE, false, category, source);
    }
    for (const [category, source] of [
      ['instance creation', 'make\n\t^self new'],
      ['accessing', 'registry\n\t^Registry'],
    ] as const) {
      q.compileMethod(session(), SOURCE, true, category, source);
    }
  };

  const fileOut = (className: string): string => {
    const tonel = fileOutClassTonel(exec, className);
    expect(isTonelFileOutError(tonel), `file out failed: ${tonel}`).toBe(false);
    // Checked on EVERY file-out in this suite, not as a separate case. A doubled
    // method is invisible to every other comparison here — both the fixpoint and
    // the declaration-sequence check would pass with duplicates on both sides —
    // so the guard has to sit where the file is produced.
    expect(duplicateDeclarationsOf(tonel), `duplicate methods in ${className}`).toEqual([]);
    return tonel;
  };

  /** Rename the class throughout the Tonel text — header and every declaration. */
  const renamed = (tonel: string): string => tonel.split(SOURCE).join(COPY);

  const fileIn = (tonel: string, dictionary = 'UserGlobals') => {
    const read = readTonelClass(exec, tonel);
    expect(read.ok, `parse failed: ${read.ok ? '' : read.error}`).toBe(true);
    if (!read.ok) throw new Error(read.error);
    return applyTonelClass(session(), read.tonelClass, dictionary);
  };

  it('is a fixpoint: out, in, out again yields the same text', (ctx) => {
    rowan3.skipUnlessAvailable(ctx);
    defineSource();
    const t1 = renamed(fileOut(SOURCE));

    const outcome = fileIn(t1);
    expect(outcome.errors).toEqual([]);
    expect(outcome.compiled).toBe(7);

    expect(fileOut(COPY)).toBe(t1);
  });

  it('carries every method across, on the right side', (ctx) => {
    rowan3.skipUnlessAvailable(ctx);
    defineSource();
    fileIn(renamed(fileOut(SOURCE)));
    expect(declarationSequenceOf(fileOut(COPY))).toEqual(
      declarationSequenceOf(renamed(fileOut(SOURCE))),
    );
  });

  it('REPLACES: a method the file does not carry is removed', (ctx) => {
    rowan3.skipUnlessAvailable(ctx);
    // The decisive case for the replace-not-merge decision.
    defineSource();
    const tonel = fileOut(SOURCE);
    q.compileMethod(session(), SOURCE, false, 'accessing', 'addedLater\n\t^42');
    expect(fileOut(SOURCE)).toContain('addedLater');

    const outcome = fileIn(tonel, 'UserGlobals');
    expect(outcome.errors).toEqual([]);
    expect(fileOut(SOURCE)).not.toContain('addedLater');
  });

  it('reports an unresolvable superclass and creates nothing', (ctx) => {
    rowan3.skipUnlessAvailable(ctx);
    defineSource();
    const orphaned = renamed(fileOut(SOURCE)).replace(
      "#superclass : 'Object'",
      "#superclass : 'JasperNoSuchSuperclass'",
    );
    const read = readTonelClass(exec, orphaned);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const outcome = applyTonelClass(session(), read.tonelClass, 'UserGlobals');
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0].message).toContain('JasperNoSuchSuperclass');
    expect(q.dictionariesContainingClass(session(), COPY)).toEqual([]);
  });

  it('files into the dictionary it is told to, not the one the file names', (ctx) => {
    rowan3.skipUnlessAvailable(ctx);
    // Tonel's #category is a PACKAGE, never a SymbolDictionary — the target is a
    // caller's choice, and this proves the file's own category does not leak into it.
    defineSource();
    fileIn(renamed(fileOut(SOURCE)), 'UserGlobals');
    expect(q.dictionariesContainingClass(session(), COPY)).toEqual(['UserGlobals']);
  });

  it('leaves the session dirty rather than committing', (ctx) => {
    rowan3.skipUnlessAvailable(ctx);
    // The harness aborts every test, and would fail the run if this committed —
    // its commit guard is the real assertion. This states the intent explicitly.
    defineSource();
    fileIn(renamed(fileOut(SOURCE)));
    expect(exec('System needsCommit printString').trim()).toBe('true');
  });
});
