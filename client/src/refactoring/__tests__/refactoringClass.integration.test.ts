import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
vi.mock('vscode', () => import('../../__mocks__/vscode'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import { escapeString } from '../../queries/util';
import { startRenameClassPreview, applyRenameClass } from '../queries/previewRenameClass';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import { parseStartPreview, parseApplyResult } from '../renameClassPreview';
import { parseClassHistory, parseRevertResult } from '../classHistoryModel';
import type { ActiveSession } from '../../sessionManager';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';

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

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));

  const rbEnginePresent = (): boolean =>
    exec(
      "(System myUserProfile symbolList objectNamed: 'GsRenameClassRefactoring') notNil printString",
    ).trim() === 'true';

  const engineTestsPayload = (): string =>
    path.resolve(__dirname, '../../../../resources/refactoring/engine-tests.gs');

  const fileInTests = (): string => {
    const p = escapeString(engineTestsPayload());
    return `[GsFileIn fromServerPath: '${p}'] on: Error do: [:e | GsFileIn fromPath: '${p}' on: #serverUtf8File to: nil].`;
  };

  it('reports rename-class engine availability matching the shared refactoring probe', () => {
    expect(rbEnginePresent()).toBe(q.checkRefactoringSupportAvailable(session()));
  });

  it('runs the rename-class and class-history GS SUnit suites in-stone with zero failures', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const code = `| failuresAndErrors |
${fileInTests()}
failuresAndErrors := 0.
#(#GsRenameClassRefactoringTest #GsClassHistoryTest)
  do: [:nm | | r |
    r := (System myUserProfile symbolList objectNamed: nm) suite run.
    failuresAndErrors := failuresAndErrors + r failures size + r errors size].
failuresAndErrors printString`;

    expect(exec(code).trim()).toBe('0');
  });

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
});
