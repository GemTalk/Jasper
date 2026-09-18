// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../tonelCapability` for the full statement. SKIPS on anything else.
//
// The property a developer actually depends on: **a small change to a class
// produces a small diff in its Tonel file.**
//
// These files exist to live in git. Header identity and method fidelity say the
// file is right once; this says it stays right in a way that is reviewable. A
// file-out that reshuffled methods, or re-emitted a category on every write,
// would pass every other suite here and still make the feature useless — every
// commit would be a whole-file rewrite and no reviewer could see the actual edit.
//
// Each case files the class out, changes ONE thing through Jasper's ordinary
// write path, files it out again, and asserts the diff is exactly that change.
// The harness aborts each test's transaction, so every case starts from the same
// class.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../../gciLibrary';
import * as q from '../../../browserQueries';
import type { ActiveSession } from '../../../sessionManager';
import { fileOutClassTonel, isTonelFileOutError } from '../fileOutClassTonel';
import { declarationSequenceOf, headerOf } from './tonelOracles';
import { diffLines, added, removed, meaningful } from './tonelDiff';
import { useRowan3Stone } from './useRowan3Stone';

const CLASS = 'JasperTonelChurnProbe';

describe('tonel file out churn (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);
  const rowan3 = useRowan3Stone(() => exec);

  // Deliberately not a trivial class: two sides, two protocols, instance and
  // class variables, a comment, and selectors spread across the alphabet so an
  // insertion lands in the MIDDLE of the sorted run rather than at an end, where
  // an ordering bug would be invisible.
  const defineClass = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${CLASS}' instVarNames: #('size' 'colour' 'label') ` +
        `classVars: #('Registry') classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals`,
    );
    q.setClassComment(session(), CLASS, 'A throwaway class for the Tonel churn tests.');
    for (const [category, source] of [
      ['accessing', 'colour ^colour'],
      ['accessing', 'colour: aValue colour := aValue'],
      ['accessing', 'label ^label'],
      ['accessing', 'size ^size'],
      ['accessing', 'size: aValue size := aValue'],
      ['printing', 'printOn: aStream aStream nextPutAll: label'],
      ['comparing', '= other ^other size = size'],
      ['private', '_reset size := nil. colour := nil'],
    ] as const) {
      q.compileMethod(session(), CLASS, false, category, source);
    }
    for (const [category, source] of [
      ['instance creation', 'make ^self new'],
      ['instance creation', 'named: aName ^self new label: aName; yourself'],
      ['accessing', 'registry ^Registry'],
    ] as const) {
      q.compileMethod(session(), CLASS, true, category, source);
    }
  };

  const fileOut = (): string => {
    const tonel = fileOutClassTonel(exec, CLASS);
    expect(isTonelFileOutError(tonel), `file out failed: ${tonel}`).toBe(false);
    return tonel;
  };

  /**
   * The changed lines, sorted.
   *
   * WHICH of several equally-good alignments a diff picks is not a property of
   * the file-out: when a new method shares a category pragma with its neighbour,
   * the identical pragma line can be attributed to either, and git does the same.
   * The order methods appear in the FILE is asserted separately, by
   * `declarationSequenceOf` — that one is a real property.
   */
  const addedLines = (changes: ReturnType<typeof diffLines>): string[] => added(changes).sort();
  const removedLines = (changes: ReturnType<typeof diffLines>): string[] => removed(changes).sort();

  /**
   * Where a method sits in the file's order.
   *
   * Matched by prefix, because a declaration keeps its ARGUMENT NAMES —
   * `Probe >> printOn: aStream`, not `Probe >> printOn:` — so an exact match
   * silently answers -1 and every comparison against it passes vacuously.
   */
  const positionOf = (order: string[], declaration: string): number => {
    const at = order.findIndex((d) => d.startsWith(declaration));
    expect(at, `not in the file: ${declaration}`).toBeGreaterThanOrEqual(0);
    return at;
  };

  /** File out, run `change`, file out again. */
  const around = (change: () => void): { before: string; after: string } => {
    defineClass();
    const before = fileOut();
    change();
    return { before, after: fileOut() };
  };

  it('shows no diff at all when nothing changes', (ctx) => {
    rowan3.skipUnlessAvailable(ctx);
    const { before, after } = around(() => {});
    expect(diffLines(before, after)).toEqual([]);
  });

  it('shows no diff when a method is recompiled with identical source', (ctx) => {
    rowan3.skipUnlessAvailable(ctx);
    // Recompiling replaces the compiled method object. If anything about the
    // file-out depended on compilation order or identity rather than on source,
    // this is where it would show.
    const { before, after } = around(() => {
      q.compileMethod(session(), CLASS, false, 'accessing', 'label ^label');
    });
    expect(diffLines(before, after)).toEqual([]);
  });

  it('adds only the new method when one is added in the middle of the order', (ctx) => {
    rowan3.skipUnlessAvailable(ctx);
    // `middle` sorts between `label` and `printOn:` — an insertion with existing
    // methods on both sides of it.
    const { before, after } = around(() => {
      q.compileMethod(session(), CLASS, false, 'accessing', 'middle ^42');
    });
    const changes = meaningful(diffLines(before, after));
    expect(removedLines(changes)).toEqual([]);
    expect(addedLines(changes)).toEqual(
      ["{ #category : 'accessing' }", `${CLASS} >> middle [ ^42`, ']'].sort(),
    );
    // And it landed in sorted position, not appended.
    const order = declarationSequenceOf(after);
    expect(positionOf(order, `${CLASS} >> label`)).toBeLessThan(
      positionOf(order, `${CLASS} >> middle`),
    );
    expect(positionOf(order, `${CLASS} >> middle`)).toBeLessThan(
      positionOf(order, `${CLASS} >> printOn:`),
    );
  });

  it('removes only the deleted method', (ctx) => {
    rowan3.skipUnlessAvailable(ctx);
    const { before, after } = around(() => {
      q.deleteMethod(session(), CLASS, false, 'label');
    });
    const changes = meaningful(diffLines(before, after));
    expect(addedLines(changes)).toEqual([]);
    expect(removedLines(changes)).toEqual(
      ["{ #category : 'accessing' }", `${CLASS} >> label [ ^label`, ']'].sort(),
    );
  });

  it("changes only the body when a method's source changes", (ctx) => {
    rowan3.skipUnlessAvailable(ctx);
    const { before, after } = around(() => {
      q.compileMethod(session(), CLASS, false, 'accessing', 'label ^label ifNil: [ 0 ]');
    });
    const changes = meaningful(diffLines(before, after));
    expect(removedLines(changes)).toEqual([`${CLASS} >> label [ ^label`]);
    expect(addedLines(changes)).toEqual([`${CLASS} >> label [ ^label ifNil: [ 0 ]`]);
  });

  it("changes only the pragma when a method's category changes, and does not reorder", (ctx) => {
    rowan3.skipUnlessAvailable(ctx);
    // Methods sort by SELECTOR, so a protocol change must move nothing. If the
    // writer ever sorted by category too, a developer tidying protocols would
    // rewrite the whole file.
    const { before, after } = around(() => {
      q.recategorizeMethod(session(), CLASS, false, 'label', 'printing');
    });
    const changes = meaningful(diffLines(before, after));
    expect(removedLines(changes)).toEqual(["{ #category : 'accessing' }"]);
    expect(addedLines(changes)).toEqual(["{ #category : 'printing' }"]);
    expect(declarationSequenceOf(after)).toEqual(declarationSequenceOf(before));
  });

  it('changes only the header when an instance variable is added', (ctx) => {
    rowan3.skipUnlessAvailable(ctx);
    // Methods coming across to the new class version is the DEFAULT case for
    // this feature's users, not a special one: Jasper's class-changing commands
    // go through the refactoring engine, which carries behaviour forward —
    // `GsInstVarStructureRefactoring >> copyMethodsFrom:to:`, "a new class
    // version starts with an empty method dictionary, so this carries the
    // behaviour forward". So this test sets up the image the way a developer's
    // edit leaves it, and asserts the file-out property that matters: adding an
    // instance variable touches the header and nothing else.
    //
    // (A BARE `subclass:` does leave the new version method-less — verified: the
    // old version keeps its methods, the name binds to the new one, class history
    // holds both. That is not a path a developer takes, and it is noted only so
    // nobody re-derives it and mistakes it for what users see.)
    const { before, after } = around(() => {
      exec(
        `| old new sl |
sl := System myUserProfile symbolList.
old := sl objectNamed: #'${CLASS}'.
new := Object subclass: '${CLASS}' instVarNames: #('size' 'colour' 'label' 'weight')
  classVars: #('Registry') classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals.
old selectors do: [:sel |
  new compileMethod: (old compiledMethodAt: sel) sourceString
    dictionaries: sl category: (old categoryOfSelector: sel)].
old class selectors do: [:sel |
  new class compileMethod: (old class compiledMethodAt: sel) sourceString
    dictionaries: sl category: (old class categoryOfSelector: sel)].
'ok'`,
      );
    });
    const changes = meaningful(diffLines(before, after));
    // Three lines, and the third is unavoidable: the previously-last instance
    // variable gains a trailing comma when it stops being last. That is inherent
    // to the list format — git shows the same — so it is asserted rather than
    // explained away.
    expect(removedLines(changes)).toEqual(["\t\t'label'"]);
    expect(addedLines(changes)).toEqual(["\t\t'label',", "\t\t'weight'"].sort());
    // The methods came across untouched, and in the same order.
    expect(declarationSequenceOf(after)).toEqual(declarationSequenceOf(before));
  });

  it('does not export a method compiled into a non-zero environment', (ctx) => {
    rowan3.skipUnlessAvailable(ctx);
    // A method compiled into environment 1 is invisible to `selectors`, so it
    // never reaches the file — verified on a rowan3 stone, where a class with one
    // env-0 and one env-1 method answers only the env-0 selector.
    //
    // This MATCHES the chunk file-out, which pins environmentId 0 deliberately
    // (see queries/fileOutMethod.ts), so both formats agree on what a file-out
    // contains. Pinned here so the agreement is deliberate rather than accidental:
    // if `selectors` ever started reporting other environments, a Tonel file would
    // silently gain methods and every file would churn at once.
    const { before, after } = around(() => {
      exec(
        `| c | c := System myUserProfile symbolList objectNamed: #'${CLASS}'. ` +
          `c compileMethod: 'hiddenInEnvOne ^1' ` +
          `dictionaries: System myUserProfile symbolList category: 'accessing' environmentId: 1. ` +
          // executeFetchString wants a String back; compileMethod: answers a GsNMethod.
          `'ok'`,
      );
    });
    expect(diffLines(before, after)).toEqual([]);
    expect(after).not.toContain('hiddenInEnvOne');
  });

  it('keeps the class side and instance side apart when a class method is added', (ctx) => {
    rowan3.skipUnlessAvailable(ctx);
    // Class-side methods are written as their own run, before the instance side.
    // A new one must land in that run, not among the instance methods.
    const { before, after } = around(() => {
      q.compileMethod(session(), CLASS, true, 'instance creation', 'blank ^self new');
    });
    const changes = meaningful(diffLines(before, after));
    expect(removedLines(changes)).toEqual([]);
    expect(addedLines(changes)).toEqual(
      ["{ #category : 'instance creation' }", `${CLASS} class >> blank [ ^self new`, ']'].sort(),
    );
    // The real property: it joined the class-side run, ahead of every instance
    // method, rather than being sorted in among them.
    const order = declarationSequenceOf(after);
    const lastClassSide = order.map((d) => / class\s*>>/.test(d)).lastIndexOf(true);
    const firstInstance = order.findIndex((d) => !/ class\s*>>/.test(d));
    expect(order).toContain(`${CLASS} class >> blank`);
    expect(lastClassSide).toBeLessThan(firstInstance);
    // Header untouched by a method addition.
    expect(headerOf(after)).toBe(headerOf(before));
  });
});
