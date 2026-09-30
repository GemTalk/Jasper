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
  const exec = async (code: string): Promise<string> => await q.executeFetchString(session(), code);
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));

  const enginePresent = async (): Promise<boolean> =>
    (
      await exec(
        '(System myUserProfile symbolList objectNamed: #GsMoveMethodRefactoring) notNil printString',
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

  const SOURCE = 'XMMItSource';
  const TARGET = 'XMMItTarget';

  const includesSelector = async (cls: string, sel: string, meta = false): Promise<boolean> =>
    (await exec(`(${cls}${meta ? ' class' : ''} includesSelector: #${sel}) printString`)).trim() ===
    'true';

  const defineFixture = async (): Promise<void> => {
    await q.compileClassDefinition(
      session(),
      `Object subclass: '${SOURCE}' instVarNames: #('balance') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    await q.compileClassDefinition(
      session(),
      `Object subclass: '${TARGET}' instVarNames: #('balance') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    await q.compileMethod(session(), SOURCE, false, 'accessing', 'pure\n\t^ 40 + 2');
    await q.compileMethod(session(), SOURCE, false, 'accessing', 'greet\n\t^ 7');
    await q.compileMethod(session(), SOURCE, false, 'accessing', 'callsSuper\n\t^ super hash');
  };

  it('reports move-method engine availability matching the shared refactoring probe', async () => {
    expect(await enginePresent()).toBe(await q.checkRefactoringSupportAvailable(session()));
  });

  it('runs the move-method GS SUnit suite in-stone with zero failures', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const code = `| r |
${fileInEngineTestsExpr()}
r := (System myUserProfile symbolList objectNamed: #GsMoveMethodRefactoringTest) suite run.
(r failures size + r errors size) printString`;

    expect((await exec(code)).trim()).toBe('0');
  }, 60_000);

  it('pre-flights a move, counting the movable selectors and skipping the rest', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineFixture();

    const analysis = parseAnalysis(
      await analyzeMoveMethod(
        asyncExec,
        SOURCE,
        ['pure', 'callsSuper'],
        false,
        TARGET,
        false,
        await userIndex(),
      ),
    );

    expect(analysis.globalDecline).toBeNull();
    expect(analysis.targetClass).toBe(TARGET);
    expect(analysis.movableCount).toBe(1);
    const superVerdict = analysis.selectors.find((s) => s.selector === 'callsSuper');
    expect(superVerdict?.decline).toContain('super');
  });

  it('relocates a method to another class and removes it from the source', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineFixture();
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
        await userIndex(),
      ),
    );
    expect(start.total).toBe(2);
    expect(start.movableCount).toBe(1);

    const result = parseApplyResult(await applyMoveMethod(asyncExec, token, [], 'test undo'));
    expect(result.applied).toBe(2);
    expect(result.failed).toEqual([]);

    expect(await includesSelector(TARGET, 'pure')).toBe(true);
    expect(await includesSelector(SOURCE, 'pure')).toBe(false);
  });

  it('moves the movable methods and leaves a non-movable one behind', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineFixture();
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
        await userIndex(),
      ),
    );
    expect(start.movableCount).toBe(2);
    expect(start.skippedMethods.map((s) => s.selector)).toContain('callsSuper');

    const result = parseApplyResult(await applyMoveMethod(asyncExec, token, [], 'test undo'));
    expect(result.applied).toBe(4);

    expect(await includesSelector(TARGET, 'pure')).toBe(true);
    expect(await includesSelector(TARGET, 'greet')).toBe(true);
    expect(await includesSelector(SOURCE, 'callsSuper')).toBe(true);
    expect(await includesSelector(TARGET, 'callsSuper')).toBe(false);
  });

  it('stages nothing when every selected method is non-movable', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineFixture();
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
        await userIndex(),
      ),
    );

    expect(start.total).toBe(0);
    expect(start.movableCount).toBe(0);
    expect(start.skippedMethods.map((s) => s.selector)).toContain('callsSuper');

    const result = parseApplyResult(await applyMoveMethod(asyncExec, token, [], 'test undo'));
    expect(result.applied).toBe(0);
    expect(result.failed).toEqual([]);

    expect(await includesSelector(SOURCE, 'callsSuper')).toBe(true);
    expect(await includesSelector(TARGET, 'callsSuper')).toBe(false);
  });

  it('flips an instance method to the class side of its own class', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineFixture();
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
        await userIndex(),
      ),
    );
    expect(start.movableCount).toBe(1);

    const result = parseApplyResult(await applyMoveMethod(asyncExec, token, [], 'test undo'));
    expect(result.applied).toBe(2);

    expect(await includesSelector(SOURCE, 'pure', true)).toBe(true);
    expect(await includesSelector(SOURCE, 'pure', false)).toBe(false);
  });
});
