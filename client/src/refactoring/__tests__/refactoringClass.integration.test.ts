import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import { startRenameClassPreview, applyRenameClass } from '../queries/previewRenameClass';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import { parseStartPreview, parseApplyResult } from '../renameClassPreview';
import { parseClassHistory, parseRevertResult } from '../classHistoryModel';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { fileInEngineTestsExpr } from './support/refactoring';

/**
 * Automatic GCI integration tests for the rename-class (R3) refactoring and the
 * class-definition history viewer, over the real GCI transport.
 *
 * Two layers, mirroring the rename-method integration test:
 *  1. The engine's GS SUnit suites, filed in from the built payload and run
 *     in-stone in one call (robust on 3.6.x).
 *  2. A client round trip through the actual query builders and parsers: preview
 *     a whole-system rename, apply it server-side, and confirm the stone was
 *     reshaped (new name bound, old gone, subclass re-parented, reference
 *     rewritten, methods carried forward, class history bumped). Plus a history
 *     read and a redo (restore a prior version).
 *
 * Gated on the engine being present (a bare stone skips the body but stays
 * green). Fully transient: the harness aborts each test, so nothing is committed.
 * All emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('rename class + class history (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = (code: string): string => q.executeFetchString(session(), code);
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));

  const rbEnginePresent = (): boolean =>
    exec(
      "(System myUserProfile symbolList objectNamed: 'GsRenameClassRefactoring') notNil printString",
    ).trim() === 'true';

  it('reports rename-class engine availability matching the shared refactoring probe', () => {
    expect(rbEnginePresent()).toBe(q.checkRefactoringSupportAvailable(session()));
  });

  it('runs the rename-class and class-history GS SUnit suites in-stone with zero failures', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const code = `| failuresAndErrors |
${fileInEngineTestsExpr()}
failuresAndErrors := 0.
#(#GsRenameClassRefactoringTest #GsClassHistoryTest)
  do: [:nm | | r |
    r := (System myUserProfile symbolList objectNamed: nm) suite run.
    failuresAndErrors := failuresAndErrors + r failures size + r errors size].
failuresAndErrors printString`;

    expect(exec(code).trim()).toBe('0');
  }, 60_000);

  const BASE = 'RCItBase';
  const SUB = 'RCItSub';
  const OTHER = 'RCItOther';
  const RENAMED = 'RCItRenamed';
  const defineFixture = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${BASE}' instVarNames: #(x) classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session(), BASE, false, 'accessing', 'foo\n\t^x');
    q.compileClassDefinition(
      session(),
      `${BASE} subclass: '${SUB}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session(), SUB, false, 'making', `bar\n\t^${BASE} new`);
    q.compileClassDefinition(
      session(),
      `Object subclass: '${OTHER}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(
      session(),
      OTHER,
      false,
      'making',
      `usesBase\n\t"a ${BASE} comment"\n\t^${BASE} new`,
    );
  };

  it('previews a whole-system class rename, then applies it server-side', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `rcit-${BASE}`;

    const start = parseStartPreview(
      await startRenameClassPreview(
        asyncExec,
        BASE,
        RENAMED,
        { kind: 'wholeSystem' },
        // Non-committing options so the harness can abort this test.
        {
          copyMethods: true,
          recompileSubclasses: true,
          migrateInstances: false,
          removeOldFromHistory: false,
        },
        token,
        PREVIEW_PAGE_BYTES,
      ),
    );

    expect(start.oldName).toBe(BASE);
    expect(start.newName).toBe(RENAMED);
    const rename = start.page.changes.find((c) => c.kind === 'classRename');
    expect(rename?.newName).toBe(RENAMED);
    const reparent = start.page.changes.find(
      (c) => c.kind === 'classReparent' && c.className === SUB,
    );
    expect(reparent?.newSource).toContain(`${RENAMED} subclass: '${SUB}'`);
    const ref = start.page.changes.find(
      (c) => c.kind === 'methodRecompile' && c.className === OTHER,
    );
    expect(ref?.newSource).toContain(`${RENAMED} new`);
    expect(ref?.newSource).toContain(`"a ${BASE} comment"`); // comment left untouched

    const result = parseApplyResult(await applyRenameClass(asyncExec, token, []));

    expect(result.failed).toEqual([]);
    expect(exec(`(UserGlobals includesKey: #${RENAMED}) printString`).trim()).toBe('true');
    expect(exec(`(UserGlobals includesKey: #${BASE}) printString`).trim()).toBe('false');
    expect(exec(`(${RENAMED} includesSelector: #foo) printString`).trim()).toBe('true');
    expect(exec(`(${SUB} superclass == ${RENAMED}) printString`).trim()).toBe('true');
    expect(
      exec(`(${OTHER} compiledMethodAt: #usesBase environmentId: 0 otherwise: nil) sourceString`),
    ).toContain(`${RENAMED} new`);
  });

  it('reads a class definition history and restores a prior version as a new one', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    // Two-version fixture: shape a, then shape a+y (new version).
    q.compileClassDefinition(
      session(),
      "Object subclass: 'RCItHist' instVarNames: #(a) classVars: #() " +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session(), 'RCItHist', false, 'accessing', 'm1\n\t^a');
    q.compileClassDefinition(
      session(),
      "Object subclass: 'RCItHist' instVarNames: #(a y) classVars: #() " +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );

    const versions = parseClassHistory(q.getClassHistory(session(), 'RCItHist'));
    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(versions[0].isCurrent).toBe(true);

    const baseline = versions[versions.length - 1]; // newest-first array; baseline is last (index 1)
    const result = parseRevertResult(q.revertClassToVersion(session(), 'RCItHist', baseline.index));
    expect(result.reverted).toBe(true);
    // Restored to the baseline shape (only a). Compare the printed instVar list
    // with whitespace stripped: the Array printString spells the class name with a
    // space ("an Array( 'a')") on 3.6.x but without one ("anArray( 'a')") on 3.7.x,
    // and an in-stone String comparison is rejected as Unicode on 3.6.2 — so
    // normalize on the client instead of asserting either exact form or comparing
    // in the stone.
    const printedInstVars = exec(
      '(RCItHist instVarNames collect: [:e | e asString]) asArray printString',
    ).replace(/\s/g, '');

    expect(printedInstVars).toBe("anArray('a')");
  });

  // Regression for finding #1 of PR #392's automated review, driven through the
  // real client query path rather than the engine SUnit. An unnamed (anonymous)
  // SymbolDictionary on the symbol list has a nil name; before the nil-guard in
  // GsRefactoringEnvironment>>class:isDefinedInDictionaryNamed:, every
  // dictionary-scoped preview sent #asSymbol to that nil and aborted with an MNU,
  // even when the real target lived in a normal named dictionary. There is no GUI
  // path to create a nameless dictionary, so this injects one directly, then
  // previews a dictionary-scoped rename the way the command dispatch does.
  const ANON_BASE = 'RCAnonBase';
  const ANON_REF = 'RCAnonRef';
  const ANON_RENAMED = 'RCAnonRenamed';
  const ANON_KEY = '#RCAnonScopeDict';

  // Insert at the FRONT (index 1), not the end: the scope scan returns as soon as
  // it finds the class in a matching named dictionary, so an anonymous dictionary
  // appended after UserGlobals would never be reached and the nil name never hit.
  // Front-inserted, it is the first dictionary every scope check examines, so the
  // pre-fix `nil asSymbol` fires immediately. (Confirmed to go red on the unguarded
  // engine.)
  const addAnonymousDictionary = (): string =>
    exec(`| anon |
anon := SymbolDictionary new.
System myUserProfile insertDictionary: anon at: 1.
SessionTemps current at: ${ANON_KEY} put: anon.
'added'`);

  const removeAnonymousDictionary = (): string =>
    exec(`| anon |
anon := SessionTemps current at: ${ANON_KEY} otherwise: nil.
anon ifNotNil: [System myUserProfile symbolList remove: anon ifAbsent: []].
SessionTemps current removeKey: ${ANON_KEY} ifAbsent: [].
'removed'`);

  // Regression for PR #392 finding #2, at the query the fix introduced. The
  // "This dictionary" rename scope must follow the class being renamed, so the
  // client resolves the class's OWN defining dictionary rather than trusting the
  // Explorer's selected dictionary. This pins that resolution against a live stone,
  // including the shadow case where the same name is bound in two dictionaries.
  const IDA = 'Pr392IntDictA';
  const IDB = 'Pr392IntDictB';

  const addIntDicts = (): string =>
    exec(`| sl a b |
sl := System myUserProfile symbolList.
a := SymbolDictionary new name: #${IDA}; yourself.
b := SymbolDictionary new name: #${IDB}; yourself.
sl add: a. sl add: b.
'ok'`);

  const removeIntDicts = (): string =>
    exec(`| sl |
sl := System myUserProfile symbolList.
(sl detect: [:d | d name == #${IDA}] ifNone: [nil]) ifNotNil: [:d | d removeKey: #Pr392IntFoo ifAbsent: []. d removeKey: #Pr392IntShadow ifAbsent: []. sl remove: d ifAbsent: []].
(sl detect: [:d | d name == #${IDB}] ifNone: [nil]) ifNotNil: [:d | d removeKey: #Pr392IntShadow ifAbsent: []. sl remove: d ifAbsent: []].
'removed'`);

  it("resolves a class's own defining dictionary independent of any selection", (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    addIntDicts();

    try {
      q.compileClassDefinition(
        session(),
        `Object subclass: 'Pr392IntFoo' instVarNames: #() classVars: #() classInstVars: #() ` +
          `poolDictionaries: #() inDictionary: (System myUserProfile symbolList detect: [:d | d name == #${IDA}])`,
      );
      q.compileClassDefinition(
        session(),
        `Object subclass: 'Pr392IntShadow' instVarNames: #() classVars: #() classInstVars: #() ` +
          `poolDictionaries: #() inDictionary: (System myUserProfile symbolList detect: [:d | d name == #${IDA}])`,
      );
      q.compileClassDefinition(
        session(),
        `Object subclass: 'Pr392IntShadow' instVarNames: #() classVars: #() classInstVars: #() ` +
          `poolDictionaries: #() inDictionary: (System myUserProfile symbolList detect: [:d | d name == #${IDB}])`,
      );

      const idxOf = (name: string): number =>
        Number(
          exec(
            `(System myUserProfile symbolList indexOf: ` +
              `(System myUserProfile symbolList detect: [:d | d name == #${name}])) printString`,
          ).trim(),
        );
      const idxA = idxOf(IDA);
      const idxB = idxOf(IDB);

      expect(q.classDefiningDictionaryName(session(), 'Pr392IntFoo', undefined)).toBe(IDA);
      expect(q.classDefiningDictionaryName(session(), 'Pr392IntShadow', idxA)).toBe(IDA);
      expect(q.classDefiningDictionaryName(session(), 'Pr392IntShadow', idxB)).toBe(IDB);
    } finally {
      removeIntDicts();
    }
  });

  it('previews a dictionary-scoped rename when an unnamed dictionary is on the symbol list', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    q.compileClassDefinition(
      session(),
      `Object subclass: '${ANON_BASE}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileClassDefinition(
      session(),
      `Object subclass: '${ANON_REF}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session(), ANON_REF, false, 'making', `usesBase\n\t^${ANON_BASE} new`);
    addAnonymousDictionary();

    try {
      const start = parseStartPreview(
        await startRenameClassPreview(
          asyncExec,
          ANON_BASE,
          ANON_RENAMED,
          { kind: 'dictionary', dictName: 'UserGlobals' },
          {
            copyMethods: true,
            recompileSubclasses: true,
            migrateInstances: false,
            removeOldFromHistory: false,
          },
          `rcit-anon-${ANON_BASE}`,
          PREVIEW_PAGE_BYTES,
        ),
      );

      expect(start.oldName).toBe(ANON_BASE);
      expect(start.newName).toBe(ANON_RENAMED);
      const rename = start.page.changes.find((c) => c.kind === 'classRename');
      expect(rename?.newName).toBe(ANON_RENAMED);

      // The in-scope external reference must be found and staged. Pre-fix, the
      // scope scan hit the nil-named dictionary first, and this reference was
      // silently dropped from the preview (no error surfaced to the user).
      const ref = start.page.changes.find(
        (c) => c.kind === 'methodRecompile' && c.className === ANON_REF,
      );
      expect(ref, 'in-scope reference was dropped (nil-named-dictionary regression)').toBeDefined();
      expect(ref?.newSource).toContain(`${ANON_RENAMED} new`);
    } finally {
      removeAnonymousDictionary();
    }
  });
});
