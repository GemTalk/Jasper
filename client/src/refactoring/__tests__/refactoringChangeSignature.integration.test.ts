import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import {
  analyzeChangeSignature,
  startChangeSignaturePreview,
  applyChangeSignature,
} from '../queries/previewChangeSignature';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import { parseAnalysis, parseStartPreview, parseApplyResult } from '../changeSignaturePreview';
import type { ActiveSession } from '../../sessionManager';

/**
 * Automatic GCI integration test for the change-method-signature (M5) refactoring,
 * over the real GCI transport — a client round trip through the actual query builders
 * and parsers: pre-flight analyze, start the paginated preview, then apply server-side
 * and confirm the stone was reshaped (add a parameter to a method and its sender).
 *
 * The availability probe always runs; the round-trip cases skip-with-reason when the
 * engine class is absent (RH pattern), so this is safe against any stone. Fully
 * transient: the useIntegrationTest harness aborts each test, so the fixture classes
 * and the applied change are rolled back and nothing is committed. All emitted
 * Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('change method signature (integration)', () => {
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
      "(System myUserProfile symbolList objectNamed: 'GsChangeSignatureRefactoring') notNil printString",
    ).trim() === 'true';

  const BASE = 'CSigItBase';
  const defineFixture = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${BASE}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    // The body uses only `k`, so adding an unused `v` parameter is behaviour-preserving.
    q.compileMethod(session(), BASE, false, 'accessing', 'at: k\n\t^Array with: k');
    q.compileMethod(session(), BASE, false, 'accessing', 'caller\n\t^self at: 1');
  };

  it('reports change-signature engine availability matching the shared probe', () => {
    expect(rbEnginePresent()).toBe(q.checkRefactoringSupportAvailable(session()));
  });

  it('pre-flight analyses the method arity and argument names', async (ctx) => {
    if (!rbEnginePresent()) ctx.skip('refactoring engine not loaded in this stone');

    defineFixture();

    const analysis = parseAnalysis(await analyzeChangeSignature(asyncExec, BASE, 'at:', false));

    expect(analysis.decline).toBeNull();
    expect(analysis.selectorKind).toBe('keyword');
    expect(analysis.arity).toBe(1);
    expect(analysis.argNames).toEqual(['k']);
  });

  it('previews adding a parameter through the paginated query, then applies it server-side', async (ctx) => {
    if (!rbEnginePresent()) ctx.skip('refactoring engine not loaded in this stone');

    defineFixture();
    const token = `csigit-${BASE}`;

    const start = parseStartPreview(
      await startChangeSignaturePreview(
        asyncExec,
        BASE,
        'at:',
        ['at:', 'put:'],
        [1, 0],
        ['k', 'v'],
        ['', 'nil'],
        { kind: 'wholeSystem' },
        token,
        PREVIEW_PAGE_BYTES,
        false,
      ),
    );

    expect(start.token).toBe(token);
    expect(start.outOfScope.collision).toBeNull();
    expect(start.outOfScope.decline).toBeNull();
    expect(start.total).toBeGreaterThanOrEqual(2);
    const impl = start.page.changes.find((c) => c.kind === 'methodRename' && c.className === BASE);
    expect(impl?.newSelector).toBe('at:put:');
    const sender = start.page.changes.find(
      (c) => c.kind === 'methodRecompile' && c.selector === 'caller',
    );
    expect(sender?.newSource).toContain('put: nil');

    const result = parseApplyResult(await applyChangeSignature(asyncExec, token, []));

    expect(result.failed).toEqual([]);
    expect(result.applied).toBeGreaterThanOrEqual(2);
    expect(
      exec(
        `(${BASE} compiledMethodAt: #'at:put:' environmentId: 0 otherwise: nil) notNil printString`,
      ).trim(),
    ).toBe('true');
    expect(
      exec(
        `(${BASE} compiledMethodAt: #'at:' environmentId: 0 otherwise: nil) isNil printString`,
      ).trim(),
    ).toBe('true');
  });
});
