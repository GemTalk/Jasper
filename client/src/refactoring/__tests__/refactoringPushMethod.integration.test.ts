import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
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
import { fileInEngineTestsExpr } from './support/refactoring';

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
    // Push-DOWN where subclass A already overrides -> an opt-in overwrite for A.
    q.compileMethod(session(), BASE, false, 'accessing', "pumOver\n\t^'base'");
    q.compileMethod(session(), SUBA, false, 'accessing', "pumOver\n\t^'a'");
    // Push-UP candidates on subclass A.
    q.compileMethod(session(), SUBA, false, 'accessing', 'pumUpPure\n\t^7');
    q.compileMethod(session(), SUBA, false, 'accessing', 'pumUpSuper\n\t^super hash');
    // Push-UP where the superclass already defines it -> an opt-in overwrite.
    q.compileMethod(session(), BASE, false, 'accessing', "pumCollide\n\t^'base'");
    q.compileMethod(session(), SUBA, false, 'accessing', "pumCollide\n\t^'suba'");
  };

  const definesSelector = (cls: string, selector: string): boolean =>
    exec(
      `(${cls} compiledMethodAt: #'${selector}' environmentId: 0 otherwise: nil) notNil printString`,
    ).trim() === 'true';

  const sourceOf = (cls: string, selector: string): string =>
    exec(
      `(${cls} compiledMethodAt: #'${selector}' environmentId: 0 otherwise: nil) ` +
        "ifNil: [''] ifNotNil: [:m | m sourceString]",
    );

  it('reports push engine availability matching the shared refactoring probe', () => {
    expect(enginePresent()).toBe(q.checkRefactoringSupportAvailable(session()));
  });

  it('runs the push-up GS SUnit suite in-stone with zero failures', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const code = `| r |
${fileInEngineTestsExpr()}
r := (System myUserProfile symbolList objectNamed: #GsPushUpMethodRefactoringTest) suite run.
(r failures size + r errors size) printString`;

    expect(exec(code).trim()).toBe('0');
  });

  it('runs the push-down GS SUnit suite in-stone with zero failures', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const code = `| r |
${fileInEngineTestsExpr()}
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
    const result = parseApplyResult(await applyPushMethod(asyncExec, 'up', token, [], 'test undo'));

    expect(result.failed).toEqual([]);
    expect(definesSelector(BASE, 'pumUpPure')).toBe(true);
    expect(definesSelector(SUBA, 'pumUpPure')).toBe(false);
  });

  it('pushes up onto a colliding superclass as an opt-in overwrite', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const analysis = parseAnalysis(
      await analyzePushMethod(asyncExec, 'up', SUBA, ['pumCollide'], false),
    );
    expect(analysis.movableCount).toBe(1);
    expect(analysis.selectors[0].decline).toBeNull();
    expect(analysis.selectors[0].warning).not.toBeNull();

    const token = `pum-up-collide-${SUBA}`;
    const start = parseStartPreview(
      await startPushMethodPreview(
        asyncExec,
        'up',
        SUBA,
        ['pumCollide'],
        false,
        token,
        PREVIEW_PAGE_BYTES,
      ),
    );
    const add = start.page.changes.find((c) => c.kind === 'methodAdd');
    expect(add?.warning).not.toBeNull();
    expect(add?.oldSource).toContain('base');
    const result = parseApplyResult(await applyPushMethod(asyncExec, 'up', token, [], 'test undo'));

    expect(result.failed).toEqual([]);
    expect(sourceOf(BASE, 'pumCollide')).toContain('suba');
    expect(definesSelector(SUBA, 'pumCollide')).toBe(false);
  });

  it('keeps the source and the superclass method when a push-up overwrite is deselected', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `pum-up-collide-deselect-${SUBA}`;
    const start = parseStartPreview(
      await startPushMethodPreview(
        asyncExec,
        'up',
        SUBA,
        ['pumCollide'],
        false,
        token,
        PREVIEW_PAGE_BYTES,
      ),
    );
    const add = start.page.changes.find((c) => c.kind === 'methodAdd');

    const result = parseApplyResult(
      await applyPushMethod(asyncExec, 'up', token, [add!.id], 'test undo'),
    );

    expect(result.failed).toEqual([]);
    expect(sourceOf(BASE, 'pumCollide')).toContain('base'); // superclass unchanged
    expect(definesSelector(SUBA, 'pumCollide')).toBe(true); // source NOT stranded
  });

  it('shows an overriding subclass as an opt-in overwrite on push-down', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `pum-down-over-${BASE}`;
    const start = parseStartPreview(
      await startPushMethodPreview(
        asyncExec,
        'down',
        BASE,
        ['pumOver'],
        false,
        token,
        PREVIEW_PAGE_BYTES,
      ),
    );
    const addA = start.page.changes.find((c) => c.kind === 'methodAdd' && c.className === SUBA);
    const addB = start.page.changes.find((c) => c.kind === 'methodAdd' && c.className === SUBB);
    expect(addA?.warning).not.toBeNull(); // A already overrides -> overwrite
    expect(addB?.warning).toBeNull(); // B is a fresh add

    const result = parseApplyResult(
      await applyPushMethod(asyncExec, 'down', token, [], 'test undo'),
    );

    expect(result.failed).toEqual([]);
    expect(sourceOf(SUBA, 'pumOver')).toContain('base'); // A's override replaced
    expect(definesSelector(SUBB, 'pumOver')).toBe(true);
    expect(definesSelector(BASE, 'pumOver')).toBe(false);
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
    const result = parseApplyResult(
      await applyPushMethod(asyncExec, 'down', token, [], 'test undo'),
    );

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

    const result = parseApplyResult(
      await applyPushMethod(asyncExec, 'down', token, [addB!.id], 'test undo'),
    );

    expect(result.failed).toEqual([]);
    expect(definesSelector(BASE, 'pumDown')).toBe(true); // guarded remove skipped
    expect(definesSelector(SUBA, 'pumDown')).toBe(true);
    expect(definesSelector(SUBB, 'pumDown')).toBe(false);
  });
});
