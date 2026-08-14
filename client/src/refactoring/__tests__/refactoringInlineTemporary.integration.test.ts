import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import {
  analyzeInlineTemporary,
  startInlineTemporaryPreview,
  applyInlineTemporary,
} from '../queries/previewInlineTemporary';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import { parseAnalysis, parseStartPreview, parseApplyResult } from '../inlineTemporaryPreview';
import type { ActiveSession } from '../../sessionManager';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { fileInEngineTestsExpr } from './support/refactoring';

/**
 * Automatic GCI integration test for the inline-temporary (M4) refactoring, over the
 * real GCI transport.
 *
 * Two layers, mirroring the other refactoring integration tests:
 *  1. The engine's GS SUnit suite, filed in from the built payload and run in-stone.
 *  2. A client round trip through the real query builders and parsers: pre-flight a
 *     temporary, preview the single method rewrite, apply it, and confirm the stone
 *     inlined the temporary's value and removed the declaration.
 *
 * Gated via the shared server-plugin feature gate
 * (`requireServerPluginFeature(pluginFeatures.refactoring, …)`): the engine-dependent
 * tests run in the plugin-installed CI pass and skip, with a reason, against a bare
 * stone. Fully transient: the harness aborts each test, so nothing is committed. All
 * emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('inline temporary (integration)', () => {
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
      '(System myUserProfile symbolList objectNamed: #GsInlineTemporaryRefactoring) notNil printString',
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

  const BASE = 'XITItBase';

  const defineFixture = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${BASE}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session(), BASE, false, 'printing', 'report\n\t| t | t := self hash. ^ t');
  };

  // 1-based offset of a substring in the stored method source.
  const offsetOf = (selector: string, text: string): number => {
    const src = exec(
      `(${BASE} compiledMethodAt: #${selector} environmentId: 0 otherwise: nil) sourceString`,
    );
    return src.indexOf(text) + 1;
  };

  it('reports inline-temporary engine availability matching the shared refactoring probe', () => {
    expect(enginePresent()).toBe(q.checkRefactoringSupportAvailable(session()));
  });

  it('runs the inline-temporary GS SUnit suite in-stone with zero failures', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const code = `| r |
${fileInEngineTestsExpr()}
r := (System myUserProfile symbolList objectNamed: #GsInlineTemporaryRefactoringTest) suite run.
(r failures size + r errors size) printString`;

    expect(exec(code).trim()).toBe('0');
  });

  it('pre-flights a temporary, resolving its name', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();

    const analysis = parseAnalysis(
      await analyzeInlineTemporary(
        asyncExec,
        BASE,
        'report',
        false,
        offsetOf('report', 't :='),
        userIndex(),
      ),
    );

    expect(analysis.decline).toBeNull();
    expect(analysis.name).toBe('t');
  });

  it('applies the inline, folding the value in and removing the declaration', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `imtit-${BASE}`;

    const start = parseStartPreview(
      await startInlineTemporaryPreview(
        asyncExec,
        BASE,
        'report',
        false,
        offsetOf('report', 't :='),
        token,
        PREVIEW_PAGE_BYTES,
        userIndex(),
      ),
    );
    expect(start.total).toBe(1);
    expect(start.name).toBe('t');

    const result = parseApplyResult(await applyInlineTemporary(asyncExec, token));
    expect(result.applied).toBe(1);
    expect(result.failed).toEqual([]);

    const rewritten = exec(
      `(${BASE} compiledMethodAt: #report environmentId: 0 otherwise: nil) sourceString`,
    );
    // The temporary's value was folded in and the declaration/assignment removed.
    expect(rewritten).toContain('self hash');
    expect(rewritten).not.toContain('t :=');
  });
});
