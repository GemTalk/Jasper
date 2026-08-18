import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import {
  startRenameMethodPreview,
  pageRenameMethodPreview,
  applyRenameMethod,
  PREVIEW_PAGE_BYTES,
} from '../queries/previewRenameMethod';
import { parseStartPreview, parsePage, parseApplyResult } from '../renameMethodPreview';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { fileInEngineTestsExpr } from './support/refactoring';

/**
 * Automatic GCI integration tests for the rename-method (R2) refactoring, over
 * the real GCI transport.
 *
 * Two layers:
 *  1. The engine's GS SUnit suites, filed in from the built payload and run
 *     in-stone in a single call — comprehensive engine coverage that is robust
 *     on 3.6.x (a file-in compiles in-image, not one GCI compile per method).
 *  2. A client round trip through the actual query builders and parsers: start
 *     the paginated preview, inspect a page, then apply server-side and confirm
 *     the stone was reshaped.
 *
 * Gated on the engine being present (a bare stone skips the body but stays green,
 * like the Enhanced Inspector routing smoke test). Fully transient: the
 * useIntegrationTest harness aborts each test, so filed-in test classes, fixture
 * classes, and the applied rename are all rolled back and nothing is committed.
 * All emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('rename method (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = (code: string): string => q.executeFetchString(session(), code);
  // The paginated query builders take an async executor; the GCI sync path is
  // fine here (small fixture), so wrap it in a resolved promise.
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));

  const rbEnginePresent = (): boolean =>
    exec(
      "(System myUserProfile symbolList objectNamed: 'GsRenameMethodRefactoring') notNil printString",
    ).trim() === 'true';

  it('reports rename-method engine availability matching the ivar engine probe', () => {
    expect(rbEnginePresent()).toBe(q.checkRefactoringSupportAvailable(session()));
  });

  it('runs the engine GS SUnit suites in-stone with zero failures', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    // File in the test classes (in-image compile — robust) then run every engine
    // suite, answering the total failure+error count across all of them.
    const code = `| failuresAndErrors |
${fileInEngineTestsExpr()}
failuresAndErrors := 0.
#(#GsRenameMethodRefactoringTest #GsRenameInstanceVariableRefactoringTest #GsRefactoringEnvironmentTest #GsRefactoringChangeSetTest)
  do: [:nm | | r |
    r := (System myUserProfile symbolList objectNamed: nm) suite run.
    failuresAndErrors := failuresAndErrors + r failures size + r errors size].
failuresAndErrors printString`;

    expect(exec(code).trim()).toBe('0');
  });

  it('runs the rename-method suite alone and reports its test count', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    // The class isn't defined at this doit's compile time (it is filed in at run
    // time), so resolve it via objectNamed: rather than as a bareword.
    const code = `| r |
${fileInEngineTestsExpr()}
r := (System myUserProfile symbolList objectNamed: #GsRenameMethodRefactoringTest) suite run.
r runCount printString, ' ', (r failures size + r errors size) printString`;

    const [runCount, failed] = exec(code).trim().split(' ');
    expect(Number(runCount)).toBeGreaterThanOrEqual(15);
    expect(failed).toBe('0');
  });

  const BASE = 'RMItBase';
  const defineFixture = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${BASE}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(
      session(),
      BASE,
      false,
      'moving',
      'movePointX: x y: y\n\t^Array with: x with: y',
    );
    q.compileMethod(session(), BASE, false, 'moving', 'caller\n\t^self movePointX: 1 y: 2');
  };

  it('previews a keyword rename+reorder through the paginated query, then applies it server-side', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `rmit-${BASE}`;

    const start = parseStartPreview(
      await startRenameMethodPreview(
        asyncExec,
        BASE,
        'movePointX:y:',
        ['moveY:', 'x:'],
        [2, 1],
        { kind: 'wholeSystem' },
        token,
        PREVIEW_PAGE_BYTES,
      ),
    );

    expect(start.token).toBe(token);
    expect(start.total).toBeGreaterThanOrEqual(2);
    const impl = start.page.changes.find((c) => c.kind === 'methodRename' && c.className === BASE);
    expect(impl?.newSelector).toBe('moveY:x:');
    expect(impl?.newSource).toContain('moveY: y x: x');
    const sender = start.page.changes.find(
      (c) => c.kind === 'methodRecompile' && c.selector === 'caller',
    );
    expect(sender?.newSource).toContain('self moveY: 2 x: 1');

    const result = parseApplyResult(await applyRenameMethod(asyncExec, token, [], 'test undo'));

    expect(result.failed).toEqual([]);
    expect(result.applied).toBeGreaterThanOrEqual(2);
    expect(
      exec(
        `(${BASE} compiledMethodAt: #'moveY:x:' environmentId: 0 otherwise: nil) notNil printString`,
      ).trim(),
    ).toBe('true');
    expect(
      exec(
        `(${BASE} compiledMethodAt: #'movePointX:y:' environmentId: 0 otherwise: nil) isNil printString`,
      ).trim(),
    ).toBe('true');
  });

  it('pages a preview and honours a deselected change on apply', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `rmit-page-${BASE}`;

    const start = parseStartPreview(
      await startRenameMethodPreview(
        asyncExec,
        BASE,
        'movePointX:y:',
        ['moveY:', 'x:'],
        [2, 1],
        { kind: 'wholeSystem' },
        token,
        1, // tiny page so a second page is needed
      ),
    );
    expect(start.page.done).toBe(false);
    expect(start.page.changes.length).toBe(1);

    const page2 = parsePage(
      await pageRenameMethodPreview(asyncExec, token, start.page.nextOffset, PREVIEW_PAGE_BYTES),
    );
    expect(page2.changes.length).toBeGreaterThanOrEqual(1);

    // Deselect the sender: apply should rename the implementor but leave the caller.
    const senderId = [...start.page.changes, ...page2.changes].find(
      (c) => c.kind === 'methodRecompile' && c.selector === 'caller',
    )?.id;
    const result = parseApplyResult(
      await applyRenameMethod(asyncExec, token, senderId ? [senderId] : [], 'test undo'),
    );

    expect(result.failed).toEqual([]);
    expect(
      exec(
        `(${BASE} compiledMethodAt: #'moveY:x:' environmentId: 0 otherwise: nil) notNil printString`,
      ).trim(),
    ).toBe('true');
    expect(
      exec(`(${BASE} compiledMethodAt: #caller environmentId: 0 otherwise: nil) sourceString`),
    ).toContain('movePointX: 1 y: 2');
  });
});
