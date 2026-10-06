import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import {
  analyzeInstVarStructure,
  startInstVarStructurePreview,
  applyInstVarStructure,
  MoveArgs,
} from '../queries/previewInstVarStructure';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import { parseAnalysis, parseStartPreview, parseApplyResult } from '../instVarStructurePreview';
import type { ActiveSession } from '../../sessionManager';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import {
  fileInEngineTestsExpr,
  ownIvars as ownIvarsProbe,
  definesSelector as definesSelectorProbe,
} from './support/refactoring';

/**
 * Automatic GCI integration test for the instance-variable structure refactorings (V2
 * push up, V3 push down, V5 convert temporary), over the real GCI transport.
 *
 * Layers:
 *  1. The engine's GS SUnit suite, filed in from the built payload and run in-stone.
 *  2. Client round trips: convert a method temporary to an ivar, push an ivar up to the
 *     superclass, push an ivar down into the subclasses, and confirm the subtree's methods
 *     survive the reversioning. Plus a decline path (push down an ivar the class still uses).
 *
 * Gated via the shared server-plugin feature gate; the engine-dependent tests run in the
 * plugin-installed CI pass and skip, with a reason, against a bare stone. Fully transient:
 * the harness aborts each test, so the new class versions and fixture classes roll back and
 * nothing is committed. All emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('instance-variable structure (integration)', () => {
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
        '(System myUserProfile symbolList objectNamed: #GsInstVarStructureRefactoring) notNil printString',
      )
    ).trim() === 'true';

  const BASE = 'VsItBase';
  const MID = 'VsItMid';
  const LEAF = 'VsItLeaf';

  const defineFixture = async (): Promise<void> => {
    await q.compileClassDefinition(
      session(),
      `Object subclass: '${BASE}' instVarNames: #('shared') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    await q.compileClassDefinition(
      session(),
      `${BASE} subclass: '${MID}' instVarNames: #('mid' 'pushable') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    await q.compileClassDefinition(
      session(),
      `${MID} subclass: '${LEAF}' instVarNames: #('leaf') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    await q.compileMethod(session(), BASE, false, 'accessing', 'baseM\n\t^shared');
    await q.compileMethod(
      session(),
      BASE,
      false,
      'accessing',
      'compute\n\t| t |\n\tt := shared.\n\t^t',
    );
    await q.compileMethod(session(), MID, false, 'accessing', 'midM\n\t^mid');
    await q.compileMethod(session(), LEAF, false, 'accessing', 'leafM\n\t^leaf');
  };

  const ownIvars = async (cls: string): Promise<string> => await ownIvarsProbe(exec, cls);

  const definesSelector = async (cls: string, selector: string): Promise<boolean> =>
    await definesSelectorProbe(exec, cls, selector);

  const runToApply = async (
    op: 'convertTemp' | 'pushUp' | 'pushDown' | 'move',
    cls: string,
    varName: string,
    token: string,
    extra?: { selector: string; isMeta: boolean; varName: string },
    moveAccessors = false,
    move?: MoveArgs,
  ): Promise<void> => {
    const analysis = parseAnalysis(
      await analyzeInstVarStructure(
        asyncExec,
        op,
        cls,
        varName,
        undefined,
        extra,
        moveAccessors,
        move,
      ),
    );
    expect(analysis.decline).toBeNull();
    const start = parseStartPreview(
      await startInstVarStructurePreview(
        asyncExec,
        op,
        cls,
        varName,
        token,
        PREVIEW_PAGE_BYTES,
        undefined,
        extra,
        moveAccessors,
        move,
      ),
    );
    expect(start.outOfScope.decline).toBeNull();
    // moveAccessors alone never commits; the apply leaves both persistent options off.
    const result = parseApplyResult(await applyInstVarStructure(asyncExec, token));
    expect(result.failed).toEqual([]);
    expect(result.committed).toBe(false);
  };

  it('reports engine availability matching the shared refactoring probe', async () => {
    expect(await enginePresent()).toBe(await q.checkRefactoringSupportAvailable(session()));
  });

  it('runs the instance-variable structure GS SUnit suite in-stone with zero failures', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const code = `| r |
${fileInEngineTestsExpr()}
r := (System myUserProfile symbolList objectNamed: #GsInstVarStructureRefactoringTest) suite run.
(r failures size + r errors size) printString`;

    expect((await exec(code)).trim()).toBe('0');
  }, 60_000);

  it('converts a method temporary into an instance variable', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineFixture();
    await runToApply('convertTemp', BASE, 't', 'vs-ct', {
      selector: 'compute',
      isMeta: false,
      varName: 't',
    });

    expect(await ownIvars(BASE)).toContain("'t'");
    expect(await definesSelector(BASE, 'baseM')).toBe(true);
    expect(await definesSelector(LEAF, 'leafM')).toBe(true);
  });

  it('pushes an instance variable up to the superclass', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineFixture();
    await runToApply('pushUp', LEAF, 'leaf', 'vs-up');

    expect(await ownIvars(MID)).toContain("'leaf'");
    expect(await ownIvars(LEAF)).not.toContain("'leaf'");
    expect(await definesSelector(LEAF, 'leafM')).toBe(true);
    expect(await definesSelector(MID, 'midM')).toBe(true);
  });

  it('pushes an instance variable down into the subclasses', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineFixture();
    await runToApply('pushDown', MID, 'pushable', 'vs-down');

    expect(await ownIvars(MID)).not.toContain("'pushable'");
    expect(await ownIvars(LEAF)).toContain("'pushable'");
    expect(await definesSelector(MID, 'midM')).toBe(true);
  });

  it('declines pushing down an instance variable the class still uses', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineFixture();

    const analysis = parseAnalysis(
      await analyzeInstVarStructure(asyncExec, 'pushDown', MID, 'mid'),
    );

    expect(analysis.decline).not.toBeNull();
    expect(analysis.decline).toContain('still uses it');
  });

  it('moves a simple accessor up with the instance variable when moving accessors', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineFixture();
    // midM (`^mid`) is a simple getter of `mid`, so it travels up with the declaration.
    await runToApply('pushUp', MID, 'mid', 'vs-up-acc', undefined, true);

    expect(await ownIvars(BASE)).toContain("'mid'");
    expect(await ownIvars(MID)).not.toContain("'mid'");
    expect(await definesSelector(BASE, 'midM')).toBe(true);
    expect(await definesSelector(MID, 'midM')).toBe(false);
  });

  it('pushes down when the only own-user is a simple accessor and moves it too', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineFixture();
    // Without moving accessors this declines (see above); with it, midM moves into the subclass.
    await runToApply('pushDown', MID, 'mid', 'vs-down-acc', undefined, true);

    expect(await ownIvars(MID)).not.toContain("'mid'");
    expect(await ownIvars(LEAF)).toContain("'mid'");
    expect(await definesSelector(MID, 'midM')).toBe(false);
    expect(await definesSelector(LEAF, 'midM')).toBe(true);
  });

  it('moves an instance variable up to a chosen non-immediate ancestor', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineFixture();
    // leaf lives on Leaf; move it up two levels to Base. Leaf keeps it by inheritance.
    await runToApply('move', LEAF, 'leaf', 'vs-move-up', undefined, false, {
      targets: [BASE],
      direction: 'up',
    });

    expect(await ownIvars(BASE)).toContain("'leaf'");
    expect(await ownIvars(LEAF)).not.toContain("'leaf'");
    expect(await definesSelector(LEAF, 'leafM')).toBe(true);
  });

  it('moves an instance variable down to a chosen subclass', async (ctx) => {
    await requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    await defineFixture();
    await runToApply('move', MID, 'pushable', 'vs-move-down', undefined, false, {
      targets: [LEAF],
      direction: 'down',
    });

    expect(await ownIvars(MID)).not.toContain("'pushable'");
    expect(await ownIvars(LEAF)).toContain("'pushable'");
    expect(await definesSelector(MID, 'midM')).toBe(true);
  });
});
