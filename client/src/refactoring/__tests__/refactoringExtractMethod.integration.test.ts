import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import {
  analyzeExtractSelection,
  startExtractMethodPreview,
  applyExtractMethod,
} from '../queries/previewExtractMethod';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import { parseAnalysis, parseStartPreview, parseApplyResult } from '../extractMethodPreview';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';
import { fileInEngineTestsExpr } from './support/refactoring';

/**
 * Automatic GCI integration test for the extract-method (M1) refactoring, over the
 * real GCI transport.
 *
 * Two layers, mirroring the other refactoring integration tests:
 *  1. The engine's GS SUnit suite, filed in from the built payload and run in-stone.
 *  2. A client round trip through the real query builders and parsers: pre-flight a
 *     void statement selection, preview the two core changes, apply them, and
 *     confirm the stone created the new method and rewrote the original to send it.
 *
 * Gated on the engine being present (a bare stone skips the body but stays green,
 * with a reason). Fully transient: the harness aborts each test, so nothing is
 * committed. All emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('extract method (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = async (code: string): Promise<string> => await q.executeFetchString(session(), code);
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));

  const enginePresent = async (): Promise<boolean> =>
    (
      await exec(
        '(System myUserProfile symbolList objectNamed: #GsExtractMethodRefactoring) notNil printString',
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

  const BASE = 'XMItBase';
  const SOURCE = 'doStuff\n\tself yourself. self hash. ^1';
  const SELECTION = 'self yourself. self hash';

  const defineFixture = async (): Promise<void> => {
    await q.compileClassDefinition(
      session(),
      `Object subclass: '${BASE}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    await q.compileMethod(session(), BASE, false, 'accessing', SOURCE);
  };

  // 1-based [selStart, selStop] of the SELECTION in the stored source.
  const selectionRange = async (): Promise<{ selStart: number; selStop: number }> => {
    const src = await exec(
      `(${BASE} compiledMethodAt: #doStuff environmentId: 0 otherwise: nil) sourceString`,
    );
    const start = src.indexOf(SELECTION) + 1;
    return { selStart: start, selStop: start + SELECTION.length - 1 };
  };

  it('reports extract-method engine availability matching the shared refactoring probe', async () => {
    expect(await enginePresent()).toBe(await q.checkRefactoringSupportAvailable(session()));
  });

  it('runs the extract-method GS SUnit suite in-stone with zero failures', async (ctx) => {
    if (!(await enginePresent())) ctx.skip('refactoring engine not loaded in this stone');

    const code = `| r |
${fileInEngineTestsExpr()}
r := (System myUserProfile symbolList objectNamed: #GsExtractMethodRefactoringTest) suite run.
(r failures size + r errors size) printString`;

    expect((await exec(code)).trim()).toBe('0');
  }, 60_000);

  it('pre-flights a void statement selection as needing no arguments', async (ctx) => {
    if (!(await enginePresent())) ctx.skip('refactoring engine not loaded in this stone');

    await defineFixture();
    const { selStart, selStop } = await selectionRange();

    const analysis = parseAnalysis(
      await analyzeExtractSelection(
        asyncExec,
        BASE,
        'doStuff',
        false,
        selStart,
        selStop,
        await userIndex(),
      ),
    );

    expect(analysis.decline).toBeNull();
    expect(analysis.argCount).toBe(0);
    expect(analysis.safeVoidShape).toBe(true);
  });

  it('applies the extraction, creating the new method and rewriting the original', async (ctx) => {
    if (!(await enginePresent())) ctx.skip('refactoring engine not loaded in this stone');

    await defineFixture();
    const { selStart, selStop } = await selectionRange();
    const token = `xmit-${BASE}`;

    const start = parseStartPreview(
      await startExtractMethodPreview(
        asyncExec,
        BASE,
        'doStuff',
        false,
        selStart,
        selStop,
        'sideEffects',
        false,
        token,
        PREVIEW_PAGE_BYTES,
        await userIndex(),
      ),
    );
    expect(start.total).toBe(2);

    const result = parseApplyResult(await applyExtractMethod(asyncExec, token, [], 'test undo'));
    expect(result.applied).toBe(2);
    expect(result.failed).toEqual([]);

    expect((await exec(`(${BASE} includesSelector: #sideEffects) printString`)).trim()).toBe(
      'true',
    );
    const newSrc = await exec(
      `(${BASE} compiledMethodAt: #sideEffects environmentId: 0 otherwise: nil) sourceString`,
    );
    // The extracted method is reformatted (one statement per line).
    expect(newSrc).toContain('self yourself');
    expect(newSrc).toContain('self hash');
    const original = await exec(
      `(${BASE} compiledMethodAt: #doStuff environmentId: 0 otherwise: nil) sourceString`,
    );
    expect(original).toContain('self sideEffects');
  });
});
