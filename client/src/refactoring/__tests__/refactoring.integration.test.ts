import { describe, it, expect } from 'vitest';

// Real GCI, but stub the `vscode` module the query layer pulls in via gciLog.
import { vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode'));

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
  const exec = (code: string): string => q.executeFetchString(session(), code);

  const engineLoaded = (): boolean => q.checkRefactoringSupportAvailable(session());
  const rbEnginePresent = (): boolean =>
    exec(
      "(System myUserProfile symbolList objectNamed: 'GsRenameInstanceVariableRefactoring') notNil printString",
    ).trim() === 'true';

  const dictIndexOf = (name: string): number =>
    parseInt(
      exec(
        `| sl d | sl := System myUserProfile symbolList. ` +
          `d := sl detect: [:x | x name = #'${name}'] ifNone: [nil]. ` +
          `(d ifNil: [0] ifNotNil: [sl indexOf: d]) printString`,
      ),
      10,
    );
  const userIndex = (): number => dictIndexOf('UserGlobals');

  const COUNTER = 'JasperRivCounter';
  const SUB = 'JasperRivSub';

  // A superclass owning the `count` instance variable with a method that both
  // reads and writes it, plus a subclass whose own method also references it —
  // so the preview must reach across the hierarchy, not just the defining class.
  const defineCounterHierarchy = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${COUNTER}' instVarNames: #('count') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session(), COUNTER, false, 'accessing', 'increment count := count + 1');
    q.compileClassDefinition(
      session(),
      `${COUNTER} subclass: '${SUB}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session(), SUB, false, 'accessing', 'doubleCount ^count * 2');
    // Methods NO change set will ever mention: `label` touches no instance
    // variable, and a class-side method cannot touch one at all. These are what a
    // client-side apply destroys when the class is re-versioned.
    q.compileMethod(session(), COUNTER, false, 'printing', "label ^'counter'");
    q.compileMethod(session(), COUNTER, true, 'instance creation', 'makeOne ^self new');
    q.compileMethod(session(), SUB, false, 'printing', "subLabel ^'sub'");
  };

  // Start a preview and answer {token, changes}. Each test clears its own token so
  // a stale SessionTemps entry can never be applied by a later test.
  let tokenSeq = 0;
  const startPreview = (): { token: string; changes: RenameChange[] } => {
    const token = `rivIntegration${(tokenSeq += 1)}`;
    return parseRenamePreview(
      startRenameInstVarPreview(exec, COUNTER, 'count', 'tally', token, userIndex()),
    );
  };

  const selectorsOf = (className: string, meta: boolean): string[] => {
    const target = meta ? `${className} class` : className;
    const raw = exec(
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

  it('reports engine availability that matches whether the engine class is present', () => {
    const available = engineLoaded();

    expect(available).toBe(rbEnginePresent());
  });

  it('rewrites references across the defining class and its subclass', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineCounterHierarchy();

    const { token, changes } = startPreview();
    clearRenameInstVarPreview(exec, token);

    expect(changeFor(changes, COUNTER, 'increment')?.newSource).toContain('tally := tally + 1');
    expect(changeFor(changes, SUB, 'doubleCount')?.newSource).toContain('tally * 2');
    expect(changes.some((c) => c.newSource.includes('count'))).toBe(false);
  });

  it('rewrites the instance-variable list in the class definition', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineCounterHierarchy();

    const { token, changes } = startPreview();
    clearRenameInstVarPreview(exec, token);

    const classDef = changes.find((c) => c.kind === 'classDefinitionEdit');
    expect(classDef?.className).toBe(COUNTER);
    expect(classDef?.newSource).toContain('tally');
    expect(classDef?.newSource).not.toContain('count');
  });

  it('builds the preview without committing', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineCounterHierarchy();
    const needsCommitBefore = exec('System needsCommit printString').trim();

    const { token } = startPreview();
    clearRenameInstVarPreview(exec, token);

    expect(exec('System needsCommit printString').trim()).toBe(needsCommitBefore);
  });

  // Degradation assertion: without the engine loaded, the preview query references
  // a class that doesn't exist, so it must surface a clear error rather than
  // silently no-op-ing or returning a malformed change-set the client would
  // mis-render.
  it('surfaces a clear error instead of a malformed preview when the engine is not loaded', (ctx) => {
    requireServerPluginFeatureAbsent(pluginFeatures.refactoring, ctx, session());

    defineCounterHierarchy();

    expect(() =>
      startRenameInstVarPreview(exec, COUNTER, 'count', 'tally', 'rivAbsent', userIndex()),
    ).toThrow(BrowserQueryError);
  });

  // ---- apply path -------------------------------------------------------------
  // The preview being right says nothing about what the stone looks like after
  // Apply. Renaming reshapes the class, so every class in the subtree is
  // re-versioned onto an EMPTY method dictionary; only what the engine copies
  // forward survives. `label`, `makeOne` and `subLabel` appear in no change set,
  // which is exactly why they need asserting here.

  it('keeps every method of the defining class, both sides, after applying', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineCounterHierarchy();
    const { token } = startPreview();

    const result = parseRenameApplyResult(applyRenameInstVar(exec, token, []));
    clearRenameInstVarPreview(exec, token);

    expect(result.failed).toEqual([]);
    expect(selectorsOf(COUNTER, false).sort()).toEqual(['increment', 'label']);
    expect(selectorsOf(COUNTER, true)).toContain('makeOne');
    expect(exec(`(${COUNTER} instVarNames includes: #tally) printString`).trim()).toBe('true');
  });

  it('keeps every method of the subclass after applying', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineCounterHierarchy();
    const { token } = startPreview();

    parseRenameApplyResult(applyRenameInstVar(exec, token, []));
    clearRenameInstVarPreview(exec, token);

    expect(selectorsOf(SUB, false).sort()).toEqual(['doubleCount', 'subLabel']);
  });

  it('rewrites the accessing methods to the new name after applying', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineCounterHierarchy();
    const { token } = startPreview();

    parseRenameApplyResult(applyRenameInstVar(exec, token, []));
    clearRenameInstVarPreview(exec, token);

    const src = exec(`(${COUNTER} compiledMethodAt: #increment) sourceString printString`);
    expect(src).toContain('tally');
    expect(src).not.toContain('count');
  });

  it('drops only the method whose change was deselected', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineCounterHierarchy();
    const { token, changes } = startPreview();
    const keep = changes
      .filter((c) => changeFor([c], COUNTER, 'increment') === undefined)
      .map((c) => c.id);

    parseRenameApplyResult(applyRenameInstVar(exec, token, deselectedIdsFrom(changes, keep)));
    clearRenameInstVarPreview(exec, token);

    expect(selectorsOf(COUNTER, false)).toEqual(['label']);
    expect(selectorsOf(COUNTER, true)).toContain('makeOne');
    expect(selectorsOf(SUB, false).sort()).toEqual(['doubleCount', 'subLabel']);
  });
});
