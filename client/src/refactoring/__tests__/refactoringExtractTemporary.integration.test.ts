import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import {
  analyzeExtractTemporary,
  startExtractTemporaryPreview,
  applyExtractTemporary,
} from '../queries/previewExtractTemporary';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import { parseAnalysis, parseStartPreview, parseApplyResult } from '../extractTemporaryPreview';
import type { ActiveSession } from '../../sessionManager';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { fileInEngineTestsExpr } from './support/refactoring';

/**
 * Automatic GCI integration test for the extract-temporary (M3) refactoring, over the
 * real GCI transport.
 *
 * Two layers, mirroring the other refactoring integration tests:
 *  1. The engine's GS SUnit suite, filed in from the built payload and run in-stone.
 *  2. A client round trip through the real query builders and parsers: pre-flight a
 *     repeated expression, preview the single method rewrite, apply it, and confirm
 *     the stone introduced the temporary in the method.
 *
 * Gated via the shared server-plugin feature gate
 * (`requireServerPluginFeature(pluginFeatures.refactoring, …)`): the engine-dependent
 * tests run in the plugin-installed CI pass and skip, with a reason, against a bare
 * stone. Fully transient: the harness aborts each test, so nothing is committed. All
 * emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('extract temporary (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));

  const enginePresent = (): boolean =>
    exec(
      '(System myUserProfile symbolList objectNamed: #GsExtractTemporaryRefactoring) notNil printString',
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

  const BASE = 'XETItBase';
  const SOURCE = 'doStuff\n\t^ self hash + self hash';
  const SELECTION = 'self hash';

  const defineFixture = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${BASE}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session(), BASE, false, 'accessing', SOURCE);
  };

  // 1-based [selStart, selStop] of the first SELECTION in the stored source.
  const selectionRange = (): { selStart: number; selStop: number } => {
    const src = exec(
      `(${BASE} compiledMethodAt: #doStuff environmentId: 0 otherwise: nil) sourceString`,
    );
    const start = src.indexOf(SELECTION) + 1;
    return { selStart: start, selStop: start + SELECTION.length - 1 };
  };

  it('reports extract-temporary engine availability matching the shared refactoring probe', () => {
    expect(enginePresent()).toBe(q.checkRefactoringSupportAvailable(session()));
  });

  it('runs the extract-temporary GS SUnit suite in-stone with zero failures', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const code = `| r |
${fileInEngineTestsExpr()}
r := (System myUserProfile symbolList objectNamed: #GsExtractTemporaryRefactoringTest) suite run.
(r failures size + r errors size) printString`;

    expect(exec(code).trim()).toBe('0');
  });

  it('pre-flights a repeated expression, counting its occurrences', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const { selStart, selStop } = selectionRange();

    const analysis = parseAnalysis(
      await analyzeExtractTemporary(
        asyncExec,
        BASE,
        'doStuff',
        false,
        selStart,
        selStop,
        userIndex(),
      ),
    );

    expect(analysis.decline).toBeNull();
    expect(analysis.occurrenceCount).toBeGreaterThanOrEqual(1);
  });

  it('applies the extraction, introducing the temporary in the method', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const { selStart, selStop } = selectionRange();
    const token = `xetit-${BASE}`;

    const start = parseStartPreview(
      await startExtractTemporaryPreview(
        asyncExec,
        BASE,
        'doStuff',
        false,
        selStart,
        selStop,
        'tmp',
        false,
        token,
        PREVIEW_PAGE_BYTES,
        userIndex(),
      ),
    );
    expect(start.total).toBe(1);

    const result = parseApplyResult(await applyExtractTemporary(asyncExec, token, 'test undo'));
    expect(result.applied).toBe(1);
    expect(result.failed).toEqual([]);

    const rewritten = exec(
      `(${BASE} compiledMethodAt: #doStuff environmentId: 0 otherwise: nil) sourceString`,
    );
    // Replace-only-selected semantics (replaceAll: false on an expression that appears
    // twice): the temp is assigned the extracted expression, the FIRST occurrence became
    // `tmp`, and the SECOND `self hash` is left untouched. A replace-all would instead
    // have produced `tmp + tmp`, so this pins the choice rather than merely that some
    // `tmp` assignment appeared.
    expect(rewritten).toContain('tmp := self hash');
    expect(rewritten).toContain('tmp + self hash');
  });
});
