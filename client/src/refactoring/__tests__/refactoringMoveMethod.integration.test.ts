import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import {
  analyzeMoveMethod,
  startMoveMethodPreview,
  applyMoveMethod,
} from '../queries/previewMoveMethod';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import { parseAnalysis, parseStartPreview, parseApplyResult } from '../moveMethodPreview';
import type { ActiveSession } from '../../sessionManager';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { fileInEngineTestsExpr } from './support/refactoring';

/**
 * Automatic GCI integration test for the move-method (M6) refactoring, over the real
 * GCI transport.
 *
 * Two layers, mirroring the other refactoring integration tests:
 *  1. The engine's GS SUnit suite, filed in from the built payload and run in-stone.
 *  2. A client round trip through the real query builders and parsers: pre-flight a
 *     move, preview the add+remove pair, apply, and confirm the stone relocated the
 *     method — a single cross-class move, a multi-move that skips a non-movable
 *     selector, and an instance→class side flip.
 *
 * Gated via the shared server-plugin feature gate
 * (`requireServerPluginFeature(pluginFeatures.refactoring, …)`): the engine-dependent
 * tests run in the plugin-installed CI pass and skip, with a reason, against a bare
 * stone. Fully transient: the harness aborts each test, so nothing is committed. All
 * emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('move method (integration)', () => {
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
      '(System myUserProfile symbolList objectNamed: #GsMoveMethodRefactoring) notNil printString',
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

  const SOURCE = 'XMMItSource';
  const TARGET = 'XMMItTarget';

  const includesSelector = (cls: string, sel: string, meta = false): boolean =>
    exec(`(${cls}${meta ? ' class' : ''} includesSelector: #${sel}) printString`).trim() === 'true';

  const defineFixture = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${SOURCE}' instVarNames: #('balance') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileClassDefinition(
      session(),
      `Object subclass: '${TARGET}' instVarNames: #('balance') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session(), SOURCE, false, 'accessing', 'pure\n\t^ 40 + 2');
    q.compileMethod(session(), SOURCE, false, 'accessing', 'greet\n\t^ 7');
    q.compileMethod(session(), SOURCE, false, 'accessing', 'callsSuper\n\t^ super hash');
  };

  it('reports move-method engine availability matching the shared refactoring probe', () => {
    expect(enginePresent()).toBe(q.checkRefactoringSupportAvailable(session()));
  });

  it('runs the move-method GS SUnit suite in-stone with zero failures', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const code = `| r |
${fileInEngineTestsExpr()}
r := (System myUserProfile symbolList objectNamed: #GsMoveMethodRefactoringTest) suite run.
(r failures size + r errors size) printString`;

    expect(exec(code).trim()).toBe('0');
  });

  it('pre-flights a move, counting the movable selectors and skipping the rest', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();

    const analysis = parseAnalysis(
      await analyzeMoveMethod(
        asyncExec,
        SOURCE,
        ['pure', 'callsSuper'],
        false,
        TARGET,
        false,
        userIndex(),
      ),
    );

    expect(analysis.globalDecline).toBeNull();
    expect(analysis.targetClass).toBe(TARGET);
    expect(analysis.movableCount).toBe(1);
    const superVerdict = analysis.selectors.find((s) => s.selector === 'callsSuper');
    expect(superVerdict?.decline).toContain('super');
  });

  it('relocates a method to another class and removes it from the source', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `xmmit-move-${SOURCE}`;

    const start = parseStartPreview(
      await startMoveMethodPreview(
        asyncExec,
        SOURCE,
        ['pure'],
        false,
        TARGET,
        false,
        token,
        PREVIEW_PAGE_BYTES,
        userIndex(),
      ),
    );
    expect(start.total).toBe(2);
    expect(start.movableCount).toBe(1);

    const result = parseApplyResult(await applyMoveMethod(asyncExec, token, [], 'test undo'));
    expect(result.applied).toBe(2);
    expect(result.failed).toEqual([]);

    expect(includesSelector(TARGET, 'pure')).toBe(true);
    expect(includesSelector(SOURCE, 'pure')).toBe(false);
  });

  it('moves the movable methods and leaves a non-movable one behind', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `xmmit-multi-${SOURCE}`;

    const start = parseStartPreview(
      await startMoveMethodPreview(
        asyncExec,
        SOURCE,
        ['pure', 'greet', 'callsSuper'],
        false,
        TARGET,
        false,
        token,
        PREVIEW_PAGE_BYTES,
        userIndex(),
      ),
    );
    expect(start.movableCount).toBe(2);
    expect(start.skippedMethods.map((s) => s.selector)).toContain('callsSuper');

    const result = parseApplyResult(await applyMoveMethod(asyncExec, token, [], 'test undo'));
    expect(result.applied).toBe(4);

    expect(includesSelector(TARGET, 'pure')).toBe(true);
    expect(includesSelector(TARGET, 'greet')).toBe(true);
    expect(includesSelector(SOURCE, 'callsSuper')).toBe(true);
    expect(includesSelector(TARGET, 'callsSuper')).toBe(false);
  });

  it('stages nothing when every selected method is non-movable', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `xmmit-none-${SOURCE}`;

    const start = parseStartPreview(
      await startMoveMethodPreview(
        asyncExec,
        SOURCE,
        ['callsSuper'],
        false,
        TARGET,
        false,
        token,
        PREVIEW_PAGE_BYTES,
        userIndex(),
      ),
    );

    expect(start.total).toBe(0);
    expect(start.movableCount).toBe(0);
    expect(start.skippedMethods.map((s) => s.selector)).toContain('callsSuper');

    const result = parseApplyResult(await applyMoveMethod(asyncExec, token, [], 'test undo'));
    expect(result.applied).toBe(0);
    expect(result.failed).toEqual([]);

    expect(includesSelector(SOURCE, 'callsSuper')).toBe(true);
    expect(includesSelector(TARGET, 'callsSuper')).toBe(false);
  });

  it('flips an instance method to the class side of its own class', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `xmmit-flip-${SOURCE}`;

    const start = parseStartPreview(
      await startMoveMethodPreview(
        asyncExec,
        SOURCE,
        ['pure'],
        false,
        SOURCE,
        true,
        token,
        PREVIEW_PAGE_BYTES,
        userIndex(),
      ),
    );
    expect(start.movableCount).toBe(1);

    const result = parseApplyResult(await applyMoveMethod(asyncExec, token, [], 'test undo'));
    expect(result.applied).toBe(2);

    expect(includesSelector(SOURCE, 'pure', true)).toBe(true);
    expect(includesSelector(SOURCE, 'pure', false)).toBe(false);
  });
});
