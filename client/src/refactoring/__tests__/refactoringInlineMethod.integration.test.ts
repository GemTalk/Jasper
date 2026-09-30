import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import {
  analyzeInlineSend,
  startInlineMethodPreview,
  applyInlineMethod,
} from '../queries/previewInlineMethod';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import { parseAnalysis, parseStartPreview, parseApplyResult } from '../inlineMethodPreview';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';
import { fileInEngineTestsExpr } from './support/refactoring';

/**
 * Automatic GCI integration test for the inline-method (M2) refactoring, over the
 * real GCI transport.
 *
 * Two layers, mirroring the other refactoring integration tests:
 *  1. The engine's GS SUnit suite, filed in from the built payload and run in-stone.
 *  2. A client round trip through the real query builders and parsers: pre-flight a
 *     self send, preview the change(s), apply, and confirm the stone inlined the
 *     body — one case with another sender (the target is kept) and one last-sender
 *     case (the now-unused target is removed).
 *
 * Gated on the engine being present (a bare stone skips the body but stays green,
 * with a reason). Fully transient: the harness aborts each test, so nothing is
 * committed. All emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('inline method (integration)', () => {
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
        '(System myUserProfile symbolList objectNamed: #GsInlineMethodRefactoring) notNil printString',
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

  const BASE = 'XIMItBase';

  const defineFixture = async (): Promise<void> => {
    await q.compileClassDefinition(
      session(),
      `Object subclass: '${BASE}' instVarNames: #('count') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    // A target with more than one sender (kept on inline) ...
    await q.compileMethod(session(), BASE, false, 'accessing', 'total\n\t^ count');
    await q.compileMethod(session(), BASE, false, 'printing', 'report\n\t^ self total');
    await q.compileMethod(session(), BASE, false, 'printing', 'report2\n\t^ self total');
    // ... and a target sent from exactly one place (removed on inline).
    await q.compileMethod(session(), BASE, false, 'accessing', 'ximSolo\n\t^ count');
    await q.compileMethod(session(), BASE, false, 'printing', 'useSolo\n\t^ self ximSolo');
  };

  // 1-based offset of a send's selector text in the stored caller source.
  const sendOffset = async (caller: string, sendText: string): Promise<number> => {
    const src = await exec(
      `(${BASE} compiledMethodAt: #${caller} environmentId: 0 otherwise: nil) sourceString`,
    );
    return src.indexOf(sendText) + 1;
  };

  it('reports inline-method engine availability matching the shared refactoring probe', async () => {
    expect(await enginePresent()).toBe(await q.checkRefactoringSupportAvailable(session()));
  });

  it('runs the inline-method GS SUnit suite in-stone with zero failures', async (ctx) => {
    if (!(await enginePresent())) ctx.skip('refactoring engine not loaded in this stone');

    const code = `| r |
${fileInEngineTestsExpr()}
r := (System myUserProfile symbolList objectNamed: #GsInlineMethodRefactoringTest) suite run.
(r failures size + r errors size) printString`;

    expect((await exec(code)).trim()).toBe('0');
  }, 60_000);

  it('pre-flights a self send, resolving the target method', async (ctx) => {
    if (!(await enginePresent())) ctx.skip('refactoring engine not loaded in this stone');

    await defineFixture();

    const analysis = parseAnalysis(
      await analyzeInlineSend(
        asyncExec,
        BASE,
        'report',
        false,
        await sendOffset('report', 'total'),
        await userIndex(),
      ),
    );

    expect(analysis.decline).toBeNull();
    expect(analysis.targetSelector).toBe('total');
  });

  it('inlines one call and keeps the target when other senders remain', async (ctx) => {
    if (!(await enginePresent())) ctx.skip('refactoring engine not loaded in this stone');

    await defineFixture();
    const token = `imit-keep-${BASE}`;

    const start = parseStartPreview(
      await startInlineMethodPreview(
        asyncExec,
        BASE,
        'report',
        false,
        await sendOffset('report', 'total'),
        token,
        PREVIEW_PAGE_BYTES,
        await userIndex(),
      ),
    );
    expect(start.total).toBe(1);
    expect(start.lastSender).toBe(false);

    const result = parseApplyResult(await applyInlineMethod(asyncExec, token, [], 'test undo'));
    expect(result.applied).toBe(1);
    expect(result.failed).toEqual([]);

    expect((await exec(`(${BASE} includesSelector: #total) printString`)).trim()).toBe('true');
    const rewritten = await exec(
      `(${BASE} compiledMethodAt: #report environmentId: 0 otherwise: nil) sourceString`,
    );
    expect(rewritten).toContain('count');
    expect(rewritten).not.toContain('self total');
  });

  it('inlines the last sender and removes the now-unused target', async (ctx) => {
    if (!(await enginePresent())) ctx.skip('refactoring engine not loaded in this stone');

    await defineFixture();
    const token = `imit-solo-${BASE}`;

    const start = parseStartPreview(
      await startInlineMethodPreview(
        asyncExec,
        BASE,
        'useSolo',
        false,
        await sendOffset('useSolo', 'ximSolo'),
        token,
        PREVIEW_PAGE_BYTES,
        await userIndex(),
      ),
    );
    expect(start.total).toBe(2);
    expect(start.lastSender).toBe(true);

    const result = parseApplyResult(await applyInlineMethod(asyncExec, token, [], 'test undo'));
    expect(result.applied).toBe(2);
    expect(result.failed).toEqual([]);

    expect((await exec(`(${BASE} includesSelector: #ximSolo) printString`)).trim()).toBe('false');
    const rewritten = await exec(
      `(${BASE} compiledMethodAt: #useSolo environmentId: 0 otherwise: nil) sourceString`,
    );
    expect(rewritten).toContain('count');
  });
});
