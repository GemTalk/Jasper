import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import {
  startRenameTemporaryPreview,
  applyRenameTemporary,
} from '../queries/previewRenameTemporary';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import { parseStartPreview, parseApplyResult } from '../renameTemporaryPreview';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { fileInEngineTestsExpr } from './support/refactoring';

/**
 * Automatic GCI integration test for the rename-temporary/argument (R5)
 * refactoring, over the real GCI transport.
 *
 * Two layers, mirroring the other refactoring integration tests:
 *  1. The engine's GS SUnit suite, filed in from the built payload and run
 *     in-stone in one call.
 *  2. A client round trip through the actual query builders and parsers: preview
 *     a temporary rename in a method with an inner-shadowing block, apply it
 *     server-side, and confirm the stone recompiled the ONE method — the outer
 *     temporary renamed, the same-named block parameter (and the reference it
 *     captures) left alone — the R5 crown-jewel guarantee.
 *
 * Gated on the engine being present (a bare stone skips the body but stays
 * green). Fully transient: the harness aborts each test, so nothing is committed.
 * All emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('rename temporary/argument (integration)', () => {
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
      "(System myUserProfile symbolList objectNamed: 'GsRenameTemporaryRefactoring') notNil printString",
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

  const BASE = 'RTItBase';

  // A method whose temporary `x` is shadowed by a same-named block parameter:
  //   shadowTemp | x | x := 1. ^[:x | x + 1] value: x + x
  // Renaming the outer temporary must rewrite its own occurrences (x := 1,
  // value: x + x) and leave the block parameter (:x, x + 1) alone.
  const SOURCE = 'shadowTemp\n\t| x |\n\tx := 1.\n\t^[:x | x + 1] value: x + x';
  const defineFixture = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${BASE}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session(), BASE, false, 'accessing', SOURCE);
  };

  // The 1-based source offset of the OUTER temporary (its `x := 1` occurrence).
  const outerOffset = (): number => {
    const src = exec(
      `(${BASE} compiledMethodAt: #shadowTemp environmentId: 0 otherwise: nil) sourceString`,
    );
    return src.indexOf('x :=') + 1;
  };

  it('reports rename-temporary engine availability matching the shared refactoring probe', () => {
    expect(rbEnginePresent()).toBe(q.checkRefactoringSupportAvailable(session()));
  });

  it('runs the rename-temporary GS SUnit suite in-stone with zero failures', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const code = `| r |
${fileInEngineTestsExpr()}
r := (System myUserProfile symbolList objectNamed: #GsRenameTemporaryRefactoringTest) suite run.
(r failures size + r errors size) printString`;

    expect(exec(code).trim()).toBe('0');
  });

  it('previews the single method recompile, renaming the outer temporary only', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();

    const start = parseStartPreview(
      await startRenameTemporaryPreview(
        asyncExec,
        BASE,
        'shadowTemp',
        false,
        'x',
        'y',
        outerOffset(),
        `rtit-${BASE}`,
        PREVIEW_PAGE_BYTES,
        userIndex(),
      ),
    );

    expect(start.total).toBe(1);
    expect(start.outOfScope.collision).toBeNull();
    expect(start.outOfScope.decline).toBeNull();
    const change = start.page.changes[0];
    expect(change.selector).toBe('shadowTemp');
    expect(change.newSource).toContain('y := 1');
    expect(change.newSource).toContain('value: y + y');
    // The shadowing block parameter and its captured reference stay `x`.
    expect(change.newSource).toContain(':x |');
    expect(change.newSource).toContain('x + 1');
  });

  it('applies the rename server-side, rewriting only the outer temporary', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `rtit-apply-${BASE}`;

    await startRenameTemporaryPreview(
      asyncExec,
      BASE,
      'shadowTemp',
      false,
      'x',
      'y',
      outerOffset(),
      token,
      PREVIEW_PAGE_BYTES,
      userIndex(),
    );
    const result = parseApplyResult(await applyRenameTemporary(asyncExec, token, 'test undo'));

    expect(result.applied).toBe(1);
    expect(result.failed).toEqual([]);
    const src = exec(
      `(${BASE} compiledMethodAt: #shadowTemp environmentId: 0 otherwise: nil) sourceString`,
    );
    expect(src).toContain('y := 1');
    expect(src).toContain('value: y + y');
    // The inner block parameter was left untouched.
    expect(src).toContain(':x |');
    expect(src).toContain('x + 1');
  });
});
