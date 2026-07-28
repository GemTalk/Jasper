import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
vi.mock('vscode', () => import('../../__mocks__/vscode'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import { escapeString } from '../../queries/util';
import {
  analyzePushMethod,
  startPushMethodPreview,
  applyPushMethod,
} from '../queries/previewPushMethod';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import { parseAnalysis, parseStartPreview, parseApplyResult } from '../pushMethodPreview';
import type { ActiveSession } from '../../sessionManager';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';

/**
 * Automatic GCI integration test for the push-up / push-down method (M7 / M8)
 * refactorings, over the real GCI transport.
 *
 * Layers, mirroring the other refactoring integration tests:
 *  1. The engines' GS SUnit suites, filed in from the built payload and run in-stone.
 *  2. Client round trips through the real query builders and parsers: push a pure method
 *     UP to its superclass, decline a super-sender; push a method DOWN into every
 *     subclass, decline when there are no subclasses, and confirm a deselected subclass
 *     add leaves the source method in place (the guarded remove).
 *
 * Gated via the shared server-plugin feature gate; the engine-dependent tests run in the
 * plugin-installed CI pass and skip, with a reason, against a bare stone. Fully
 * transient: the harness aborts each test, so the fixture classes and any applied change
 * are rolled back and nothing is committed. All emitted Smalltalk is ASCII-only for the
 * 3.6.x matrix.
 */
describe('push method up/down (integration)', () => {
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
      '((System myUserProfile symbolList objectNamed: #GsPushUpMethodRefactoring) notNil and: ' +
        '[(System myUserProfile symbolList objectNamed: #GsPushDownMethodRefactoring) notNil]) printString',
    ).trim() === 'true';

  const engineTestsPayload = (): string =>
    path.resolve(__dirname, '../../../../resources/refactoring/engine-tests.gs');

  const fileInTests = (): string => {
    const p = escapeString(engineTestsPayload());
    return `[GsFileIn fromServerPath: '${p}'] on: Error do: [:e | GsFileIn fromPath: '${p}' on: #serverUtf8File to: nil].`;
  };

  const BASE = 'PumItBase';
  const SUBA = 'PumItA';
  const SUBB = 'PumItB';

  // A super/sub hierarchy with selectors unique to this fixture.
  const defineFixture = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${BASE}' instVarNames: #('state') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileClassDefinition(
      session(),
      `${BASE} subclass: '${SUBA}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileClassDefinition(
      session(),
      `${BASE} subclass: '${SUBB}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    // Push-DOWN candidates on the base.
    q.compileMethod(session(), BASE, false, 'accessing', 'pumDown\n\t^100');
    q.compileMethod(session(), BASE, false, 'accessing', 'pumSuperDown\n\t^super hash');
    // Push-UP candidates on subclass A.
    q.compileMethod(session(), SUBA, false, 'accessing', 'pumUpPure\n\t^7');
    q.compileMethod(session(), SUBA, false, 'accessing', 'pumUpSuper\n\t^super hash');
  };

  const definesSelector = (cls: string, selector: string): boolean =>
    exec(
      `(${cls} compiledMethodAt: #'${selector}' environmentId: 0 otherwise: nil) notNil printString`,
    ).trim() === 'true';

  it('reports push engine availability matching the shared refactoring probe', () => {
    expect(enginePresent()).toBe(q.checkRefactoringSupportAvailable(session()));
  });

  it('runs the push-up GS SUnit suite in-stone with zero failures', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const code = `| r |
${fileInTests()}
r := (System myUserProfile symbolList objectNamed: #GsPushUpMethodRefactoringTest) suite run.
(r failures size + r errors size) printString`;

    expect(exec(code).trim()).toBe('0');
  });

  it('runs the push-down GS SUnit suite in-stone with zero failures', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const code = `| r |
${fileInTests()}
r := (System myUserProfile symbolList objectNamed: #GsPushDownMethodRefactoringTest) suite run.
(r failures size + r errors size) printString`;

    expect(exec(code).trim()).toBe('0');
  });

  it('pushes a pure method up to its superclass', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const analysis = parseAnalysis(
      await analyzePushMethod(asyncExec, 'up', SUBA, ['pumUpPure'], false),
    );
    expect(analysis.targetClass).toBe(BASE);
    expect(analysis.movableCount).toBe(1);

    const token = `pum-up-${SUBA}`;
    const start = parseStartPreview(
      await startPushMethodPreview(
        asyncExec,
        'up',
        SUBA,
        ['pumUpPure'],
        false,
        token,
        PREVIEW_PAGE_BYTES,
      ),
    );
    expect(start.outOfScope.decline).toBeNull();
    const result = parseApplyResult(await applyPushMethod(asyncExec, 'up', token, []));

    expect(result.failed).toEqual([]);
    expect(definesSelector(BASE, 'pumUpPure')).toBe(true);
    expect(definesSelector(SUBA, 'pumUpPure')).toBe(false);
  });

  it('declines pushing up a method that sends super', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();

    const analysis = parseAnalysis(
      await analyzePushMethod(asyncExec, 'up', SUBA, ['pumUpSuper'], false),
    );

    expect(analysis.movableCount).toBe(0);
    expect(analysis.selectors[0].decline).toContain('super');
  });

  it('pushes a method down into every subclass and removes it from the source', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `pum-down-${BASE}`;

    const start = parseStartPreview(
      await startPushMethodPreview(
        asyncExec,
        'down',
        BASE,
        ['pumDown'],
        false,
        token,
        PREVIEW_PAGE_BYTES,
      ),
    );
    expect(start.total).toBe(3); // two adds + one remove
    const result = parseApplyResult(await applyPushMethod(asyncExec, 'down', token, []));

    expect(result.failed).toEqual([]);
    expect(definesSelector(SUBA, 'pumDown')).toBe(true);
    expect(definesSelector(SUBB, 'pumDown')).toBe(true);
    expect(definesSelector(BASE, 'pumDown')).toBe(false);
  });

  it('declines pushing down from a class with no subclasses', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    q.compileMethod(session(), SUBA, false, 'accessing', 'pumLeaf\n\t^1');

    const analysis = parseAnalysis(
      await analyzePushMethod(asyncExec, 'down', SUBA, ['pumLeaf'], false),
    );

    expect(analysis.globalDecline).not.toBeNull();
    expect(analysis.globalDecline).toContain('no subclasses');
  });

  it('leaves the source method in place when a subclass add is deselected', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `pum-down-deselect-${BASE}`;

    const start = parseStartPreview(
      await startPushMethodPreview(
        asyncExec,
        'down',
        BASE,
        ['pumDown'],
        false,
        token,
        PREVIEW_PAGE_BYTES,
      ),
    );
    const addB = start.page.changes.find((c) => c.kind === 'methodAdd' && c.className === SUBB);
    expect(addB).toBeDefined();

    const result = parseApplyResult(await applyPushMethod(asyncExec, 'down', token, [addB!.id]));

    expect(result.failed).toEqual([]);
    expect(definesSelector(BASE, 'pumDown')).toBe(true); // guarded remove skipped
    expect(definesSelector(SUBA, 'pumDown')).toBe(true);
    expect(definesSelector(SUBB, 'pumDown')).toBe(false);
  });
});
