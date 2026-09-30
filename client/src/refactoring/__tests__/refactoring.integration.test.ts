import { describe, it, expect } from 'vitest';

// Real GCI, but stub the `vscode` module the query layer pulls in via gciLog.
import { vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import { BrowserQueryError } from '../../browserQueries';
import {
  startRenameInstVarPreview,
  applyRenameInstVar,
  clearRenameInstVarPreview,
} from '../queries/previewRenameInstVar';
import {
  parseRenamePreview,
  parseRenameApplyResult,
  deselectedIdsFrom,
  RenameChange,
} from '../renameInstVarPreview';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';
import {
  requireServerPluginFeature,
  requireServerPluginFeatureAbsent,
} from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';

/**
 * Automatic GCI integration test for the rename-instance-variable round trip:
 * client query -> server-side refactoring engine -> change-set JSON -> client
 * parser. Exercises the real GCI transport, not a mock.
 *
 * The engine is an optional, separately-installed payload (its loader is a later
 * stage), so a bare stone does not have it. Following the Enhanced Inspector
 * routing smoke test, the availability probe is asserted on every stone, and the
 * full round trip runs only where the engine is present (a dev stone with the
 * payload loaded, or any stone once the loader ships). Both branches stay green
 * across the CI matrix rather than hard-failing on a bare stone.
 *
 * Fully transient: the useIntegrationTest harness wraps each test in a
 * begin/abort pair, so the throwaway fixture classes are rolled back and nothing
 * is ever committed. All emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('rename instance variable (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = async (code: string): Promise<string> => await q.executeFetchString(session(), code);

  const engineLoaded = async (): Promise<boolean> =>
    await q.checkRefactoringSupportAvailable(session());
  const rbEnginePresent = async (): Promise<boolean> =>
    (
      await exec(
        "(System myUserProfile symbolList objectNamed: 'GsRenameInstanceVariableRefactoring') notNil printString",
      )
    ).trim() === 'true';

  const dictIndexOf = async (name: string): Promise<number> =>
    parseInt(
      await exec(
        `| sl d | sl := System myUserProfile symbolList. ` +
          `d := sl detect: [:x | x name = #'${name}'] ifNone: [nil]. ` +
          `(d ifNil: [0] ifNotNil: [sl indexOf: d]) printString`,
      ),
      10,
    );
  const userIndex = async (): Promise<number> => await dictIndexOf('UserGlobals');

  const COUNTER = 'JasperRivCounter';
  const SUB = 'JasperRivSub';

  // A superclass owning the `count` instance variable with a method that both
  // reads and writes it, plus a subclass whose own method also references it —
  // so the preview must reach across the hierarchy, not just the defining class.
  const defineCounterHierarchy = async (): Promise<void> => {
    await q.compileClassDefinition(
      session(),
      `Object subclass: '${COUNTER}' instVarNames: #('count') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    await q.compileMethod(session(), COUNTER, false, 'accessing', 'increment count := count + 1');
    await q.compileClassDefinition(
      session(),
      `${COUNTER} subclass: '${SUB}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    await q.compileMethod(session(), SUB, false, 'accessing', 'doubleCount ^count * 2');
    // Methods NO change set will ever mention: `label` touches no instance
    // variable, and a class-side method cannot touch one at all. These are what a
    // client-side apply destroys when the class is re-versioned.
    await q.compileMethod(session(), COUNTER, false, 'printing', "label ^'counter'");
    await q.compileMethod(session(), COUNTER, true, 'instance creation', 'makeOne ^self new');
    await q.compileMethod(session(), SUB, false, 'printing', "subLabel ^'sub'");
  };

  // Start a preview and answer {token, changes}. Each test clears its own token so
  // a stale SessionTemps entry can never be applied by a later test.
  let tokenSeq = 0;
  const startPreview = async (): Promise<{ token: string; changes: RenameChange[] }> => {
    const token = `rivIntegration${(tokenSeq += 1)}`;
    return parseRenamePreview(
      await startRenameInstVarPreview(exec, COUNTER, 'count', 'tally', token, await userIndex()),
    );
  };

  const selectorsOf = async (className: string, meta: boolean): Promise<string[]> => {
    const target = meta ? `${className} class` : className;
    const raw = await exec(
      `((${target} selectors asSortedCollection asArray) ` +
        `inject: '' into: [:a :s | a, s asString, ' ']) printString`,
    );
    return raw
      .replace(/^'|'$/g, '')
      .trim()
      .split(/\s+/)
      .filter((x) => x.length > 0);
  };

  const changeFor = (
    changes: RenameChange[],
    className: string,
    selector: string,
  ): RenameChange | undefined =>
    changes.find(
      (c) => c.kind === 'methodRecompile' && c.className === className && c.selector === selector,
    );

  it('reports engine availability that matches whether the engine class is present', async () => {
    const available = await engineLoaded();

    expect(available).toBe(await rbEnginePresent());
  });

  it('rewrites references across the defining class and its subclass', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineCounterHierarchy();

    const { token, changes } = await startPreview();
    await clearRenameInstVarPreview(exec, token);

    expect(changeFor(changes, COUNTER, 'increment')?.newSource).toContain('tally := tally + 1');
    expect(changeFor(changes, SUB, 'doubleCount')?.newSource).toContain('tally * 2');
    expect(changes.some((c) => c.newSource.includes('count'))).toBe(false);
  });

  it('rewrites the instance-variable list in the class definition', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineCounterHierarchy();

    const { token, changes } = await startPreview();
    await clearRenameInstVarPreview(exec, token);

    const classDef = changes.find((c) => c.kind === 'classDefinitionEdit');
    expect(classDef?.className).toBe(COUNTER);
    expect(classDef?.newSource).toContain('tally');
    expect(classDef?.newSource).not.toContain('count');
  });

  it('builds the preview without committing', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineCounterHierarchy();
    const needsCommitBefore = (await exec('System needsCommit printString')).trim();

    const { token } = await startPreview();
    await clearRenameInstVarPreview(exec, token);

    expect((await exec('System needsCommit printString')).trim()).toBe(needsCommitBefore);
  });

  // Degradation assertion: without the engine loaded, the preview query references
  // a class that doesn't exist, so it must surface a clear error rather than
  // silently no-op-ing or returning a malformed change-set the client would
  // mis-render.
  it('surfaces a clear error instead of a malformed preview when the engine is not loaded', async (ctx) => {
    await requireServerPluginFeatureAbsent(pluginFeatures.refactoring, ctx, session());

    await defineCounterHierarchy();

    await expect(
      startRenameInstVarPreview(exec, COUNTER, 'count', 'tally', 'rivAbsent', await userIndex()),
    ).rejects.toThrow(BrowserQueryError);
  });

  // ---- inherited-ivar retarget resolution -------------------------------------
  // Invoked on an ivar INHERITED by a subclass method, the editor rename command
  // resolves the defining class and reruns the rename there so a rename is always
  // reachable from a method. That resolution is `getDefiningClassOfInstVar`; prove
  // it against the real hierarchy so the hand-written superclass walk + SymbolList
  // index lookup are exercised on a stone, not just in a unit test with a canned
  // executor.

  it('resolves an ivar inherited by a subclass to its defining class and binding dictionary', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineCounterHierarchy();

    const defining = await q.getDefiningClassOfInstVar(session(), SUB, 'count', await userIndex());

    expect(defining).toEqual({ className: COUNTER, dictIndex: await userIndex() });
  });

  it('resolves an ivar to its declaring class even when asked from that class itself', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineCounterHierarchy();

    expect(
      (await q.getDefiningClassOfInstVar(session(), COUNTER, 'count', await userIndex()))
        ?.className,
    ).toBe(COUNTER);
  });

  it('answers undefined for a word that is not a visible instance variable', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineCounterHierarchy();

    expect(
      await q.getDefiningClassOfInstVar(session(), SUB, 'notAnIvar', await userIndex()),
    ).toBeUndefined();
  });

  it('renames an inherited ivar across the whole hierarchy once retargeted to its defining class', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineCounterHierarchy();
    // Resolve the defining class the way the editor command does when the cursor is
    // on `count` in a SUB method, then run the rename against THAT class + its dict.
    const defining = await q.getDefiningClassOfInstVar(session(), SUB, 'count', await userIndex());
    if (!defining) throw new Error('expected count to resolve to its defining class');
    const { token } = parseRenamePreview(
      await startRenameInstVarPreview(
        exec,
        defining.className,
        'count',
        'tally',
        'rivRetarget',
        defining.dictIndex,
      ),
    );

    const result = parseRenameApplyResult(await applyRenameInstVar(exec, token, []));
    await clearRenameInstVarPreview(exec, token);

    expect(result.failed).toEqual([]);
    expect((await exec(`(${COUNTER} instVarNames includes: #tally) printString`)).trim()).toBe(
      'true',
    );
    // The inherited-referencing subclass method survived the re-version and now
    // reads the renamed ivar; an unrelated subclass method survives too.
    expect((await selectorsOf(SUB, false)).sort()).toEqual(['doubleCount', 'subLabel']);
    expect(await exec(`${SUB} sourceCodeAt: #doubleCount`)).toContain('tally');
  });

  // ---- class-reference resolution (editor Rename… on a class) -----------------
  // The unified Rename… resolves a bareword to a class before routing to class
  // rename. resolveClassReference is engine-independent (objectNamed: + isKindOf:
  // Class), so these need no plugin gate.

  it('resolves a class reference to the class and its binding dictionary', async () => {
    await defineCounterHierarchy();

    expect(await q.resolveClassReference(session(), COUNTER)).toEqual({
      className: COUNTER,
      dictIndex: await userIndex(),
    });
  });

  it('does not resolve an unbound name to a class', async () => {
    expect(await q.resolveClassReference(session(), 'NoSuchClassXyzzy')).toBeUndefined();
  });

  // ---- apply path -------------------------------------------------------------
  // The preview being right says nothing about what the stone looks like after
  // Apply. Renaming reshapes the class, so every class in the subtree is
  // re-versioned onto an EMPTY method dictionary; only what the engine copies
  // forward survives. `label`, `makeOne` and `subLabel` appear in no change set,
  // which is exactly why they need asserting here.

  it('keeps every method of the defining class, both sides, after applying', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineCounterHierarchy();
    const { token } = await startPreview();

    const result = parseRenameApplyResult(await applyRenameInstVar(exec, token, []));
    await clearRenameInstVarPreview(exec, token);

    expect(result.failed).toEqual([]);
    expect((await selectorsOf(COUNTER, false)).sort()).toEqual(['increment', 'label']);
    expect(await selectorsOf(COUNTER, true)).toContain('makeOne');
    expect((await exec(`(${COUNTER} instVarNames includes: #tally) printString`)).trim()).toBe(
      'true',
    );
  });

  it('keeps every method of the subclass after applying', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineCounterHierarchy();
    const { token } = await startPreview();

    parseRenameApplyResult(await applyRenameInstVar(exec, token, []));
    await clearRenameInstVarPreview(exec, token);

    expect((await selectorsOf(SUB, false)).sort()).toEqual(['doubleCount', 'subLabel']);
  });

  it('rewrites the accessing methods to the new name after applying', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineCounterHierarchy();
    const { token } = await startPreview();

    parseRenameApplyResult(await applyRenameInstVar(exec, token, []));
    await clearRenameInstVarPreview(exec, token);

    const src = await exec(`(${COUNTER} compiledMethodAt: #increment) sourceString printString`);
    expect(src).toContain('tally');
    expect(src).not.toContain('count');
  });

  it('drops only the method whose change was deselected', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineCounterHierarchy();
    const { token, changes } = await startPreview();
    const keep = changes
      .filter((c) => changeFor([c], COUNTER, 'increment') === undefined)
      .map((c) => c.id);

    parseRenameApplyResult(await applyRenameInstVar(exec, token, deselectedIdsFrom(changes, keep)));
    await clearRenameInstVarPreview(exec, token);

    expect(await selectorsOf(COUNTER, false)).toEqual(['label']);
    expect(await selectorsOf(COUNTER, true)).toContain('makeOne');
    expect((await selectorsOf(SUB, false)).sort()).toEqual(['doubleCount', 'subLabel']);
  });
});
