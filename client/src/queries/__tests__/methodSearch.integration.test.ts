// Integration tests for the method-search queries against a live stone, over the release matrix
// (3.6.2 and 3.7.5). Base-image reflection only — no server plugin — so they run in both the bare
// and plugin CI passes.
//
// Two suites, each guarding a case where the generated Smalltalk compiled and ran but the ENGINE
// API underneath it did not mean what the query assumed. A unit test that asserts on the generated
// string cannot catch that; only a live stone can.
//
//   - literalSymbolReferences: searching the Literals scope for a *symbol* returned methods that
//     only SEND the selector, never using it as a data literal — so their source doesn't contain
//     the symbol at all. The reproduction case is `#not`: `ClassOrganizer sendersOf: #not` reports
//     0 senders while `referencesToLiteral: #not` reports hundreds (the selector still sits in each
//     method's literal frame), so the "literal refs MINUS senders" heuristic subtracted nothing and
//     every `x not` method leaked in as a bogus literal hit.
//
//   - hierarchyImplementorsOf: the walk asked `includesSelector:` plus a bare `compiledMethodAt:`,
//     both of which answer for environment 0 whatever environment the caller asked about — so an
//     implementor compiled only into a higher environment was invisible, and a sweep over
//     0..maxEnvironment re-collected the same environment-0 answer once per environment.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import { defaultQueryExecutorUsing } from '../../browserQueries';
import { dedupeMethodResults, literalSymbolReferences } from '../methodSearch';
import type { ActiveSession } from '../../sessionManager';

describe('literalSymbolReferences (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;

  const CLS = 'SymbolLiteralDemo';

  // A transient fixture (rolled back by the harness's abort). One method uses `#not` as a genuine
  // DATA literal; the other only SENDS `not`. Selector spellings are unique to the fixture.
  const defineFixture = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${CLS}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    const m = (src: string): void => {
      q.compileMethod(session(), CLS, false, 'accessing', src);
    };
    m('usesNotAsLiteral\n\t^Array with: #not'); // #not is a data literal — source contains "#not"
    m('onlySendsNot: aFlag\n\t^aFlag not'); // sends not to a variable — source has "not", never "#not"
  };

  it('returns methods that use the symbol as a data literal, not ones that merely send it', () => {
    defineFixture();

    const rows = literalSymbolReferences(defaultQueryExecutorUsing(session()), '#not');
    const fixtureRow = (selector: string) =>
      rows.find((r) => r.className === CLS && !r.isMeta && r.selector === selector);

    expect(fixtureRow('usesNotAsLiteral')).toBeDefined();
    expect(fixtureRow('onlySendsNot:')).toBeUndefined();
  });
});

describe('hierarchyImplementorsOf (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;

  const BASE = 'HierEnvDemoBase';
  const MIDDLE = 'HierEnvDemoMiddle';
  const UPPER = 'HierEnvDemoUpper';
  const LEAF = 'HierEnvDemoLeaf';
  const SEL = 'hedValue';
  const META_SEL = 'hedClassValue';

  // A four-deep transient chain (rolled back by the harness's abort) implementing the SAME
  // selector on four classes across THREE environments — one distinct class per
  // (direction, environment) pair:
  //
  //   HierEnvDemoBase        hedValue in environment 0   <- pivot for 'down'
  //     HierEnvDemoMiddle    hedValue in environment 1
  //       HierEnvDemoUpper   hedValue in environment 2
  //         HierEnvDemoLeaf  hedValue in environment 0   <- pivot for 'up'
  //
  // Three environments rather than one is what lets these tests fail the old behavior. When every
  // environment answered environment 0, each pass of a sweep returned the SAME class — so a fixture
  // holding a single implementor would still have looked correct at environment 0, and a fixture
  // holding one implementor per environment is the smallest one whose answers differ per pass.
  //
  // 'up' starts at the pivot's SUPERCLASS and 'down' walks allSubclasses, so each pivot's own
  // implementation lies outside its own walk — which is why both ends can carry an environment-0
  // method without either direction's test seeing it.
  const defineFixture = (): void => {
    const subclass = (superName: string, name: string): void => {
      q.compileClassDefinition(
        session(),
        `${superName} subclass: '${name}' instVarNames: #() classVars: #() ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
      );
    };
    subclass('Object', BASE);
    subclass(BASE, MIDDLE);
    subclass(MIDDLE, UPPER);
    subclass(UPPER, LEAF);

    const m = (cls: string, isMeta: boolean, src: string, env: number): void => {
      q.compileMethod(session(), cls, isMeta, 'accessing', src, env);
    };
    m(BASE, false, `${SEL}\n\t^'base'`, 0);
    m(MIDDLE, false, `${SEL}\n\t^'middle'`, 1);
    m(UPPER, false, `${SEL}\n\t^'upper'`, 2);
    m(LEAF, false, `${SEL}\n\t^'leaf'`, 0);
    // Class side, environment 1 only. The walk's `sub class` / `class class` branch is separately
    // generated Smalltalk, so it can carry the same environment bug on its own.
    m(MIDDLE, true, `${META_SEL}\n\t^'middle class'`, 1);
  };

  const dictIndex = (): number => q.getDictionaryNames(session()).indexOf('UserGlobals') + 1;

  const implementors = (
    className: string,
    direction: 'up' | 'down',
    environmentId: number,
    isMeta = false,
    selector = SEL,
  ) =>
    q.hierarchyImplementorsOf(
      session(),
      dictIndex(),
      className,
      selector,
      isMeta,
      direction,
      environmentId,
    );

  // Class names of the implementors found, having first asserted that every row carries the
  // environment it was asked for. That stamp is part of a row's identity for
  // dedupeMethodResults, and is what opens the method that was actually found.
  const classesFound = (...args: Parameters<typeof implementors>): string[] => {
    const rows = implementors(...args);
    for (const r of rows) expect(r.environmentId).toBe(args[2]);
    return rows.map((r) => r.className);
  };

  it('walks up to the implementor compiled in each environment', () => {
    defineFixture();

    expect(classesFound(LEAF, 'up', 0)).toEqual([BASE]);
    expect(classesFound(LEAF, 'up', 1)).toEqual([MIDDLE]);
    expect(classesFound(LEAF, 'up', 2)).toEqual([UPPER]);
  });

  it('walks down to the implementor compiled in each environment', () => {
    defineFixture();

    expect(classesFound(BASE, 'down', 0)).toEqual([LEAF]);
    expect(classesFound(BASE, 'down', 1)).toEqual([MIDDLE]);
    expect(classesFound(BASE, 'down', 2)).toEqual([UPPER]);
  });

  it('collects class-side implementors in the environment they were compiled into', () => {
    defineFixture();

    expect(classesFound(LEAF, 'up', 1, true, META_SEL)).toEqual([MIDDLE]);
    expect(classesFound(BASE, 'down', 1, true, META_SEL)).toEqual([MIDDLE]);
    // Compiled into environment 1 only, so environment 0 must answer nothing rather than
    // falling back to it.
    expect(classesFound(LEAF, 'up', 0, true, META_SEL)).toEqual([]);
    expect(classesFound(BASE, 'down', 0, true, META_SEL)).toEqual([]);
  });

  it('returns a row naming the class, side, category and environment it was found in', () => {
    defineFixture();

    expect(implementors(LEAF, 'up', 2)).toEqual([
      {
        dictName: 'UserGlobals',
        className: UPPER,
        isMeta: false,
        selector: SEL,
        category: 'accessing',
        environmentId: 2,
      },
    ]);
  });

  it('answers each implementor exactly once across a 0..maxEnvironment sweep', () => {
    defineFixture();

    // What the gemstone.hierarchyImplementorsOf command does: one query per environment, then
    // dedupe. The old walk made this sweep answer the environment-0 implementor three times,
    // stamped 0, 1 and 2 — three rows dedupeMethodResults could not fold together because it
    // keys on the environment, two of which opened nothing.
    const sweep = (className: string, direction: 'up' | 'down') =>
      dedupeMethodResults([0, 1, 2].flatMap((env) => implementors(className, direction, env)))
        .map((r) => `${r.className}@${r.environmentId}`)
        .sort();

    expect(sweep(LEAF, 'up')).toEqual([`${BASE}@0`, `${MIDDLE}@1`, `${UPPER}@2`]);
    expect(sweep(BASE, 'down')).toEqual([`${LEAF}@0`, `${MIDDLE}@1`, `${UPPER}@2`]);
  });
});
