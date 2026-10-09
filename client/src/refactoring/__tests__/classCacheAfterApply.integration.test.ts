// Every refactoring that reshapes a class, applied through the client's own apply query, leaves
// the Hierarchy showing the CURRENT classes -- for the classes it reshaped and for the class above
// them.
//
// The hierarchy queries read the session's cached ClassOrganizer, which holds class objects and
// their superclass links. A reshape makes new class versions without committing, so unless the
// apply drops that cache the class above the reshaped one still lists the old version (or nothing).
// Each test warms the cache first, then asks about the UNCHANGED ancestor before anything else: the
// hierarchy lookups rebuild a stale cache when asked about a class it does not hold, and asking
// about a reshaped class first would hide a missing drop behind that repair.
//
// classCacheAfterApply.test.ts pins which apply queries drop it; this pins that dropping it is
// enough, refactoring by refactoring, against a live stone.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import { getClassHierarchy } from '../../queries/getClassHierarchy';
import { getClassDescendantNames } from '../queries/getClassDescendantNames';
import {
  startInstVarStructurePreview,
  applyInstVarStructure,
  type IvarStructureOp,
  type ConvertTempArgs,
  type MoveArgs,
} from '../queries/previewInstVarStructure';
import { parseStartPreview as parseStructureStart } from '../instVarStructurePreview';
import { startInstVarPreview, applyInstVar } from '../queries/previewInstVar';
import { parseStartPreview as parseInstVarStart } from '../instVarRefactorPreview';
import { startRenameInstVarPreview, applyRenameInstVar } from '../queries/previewRenameInstVar';
import { startRenameClassPreview, applyRenameClass } from '../queries/previewRenameClass';
import {
  startExtractSuperclassPreview,
  applyExtractSuperclass,
} from '../queries/previewExtractSuperclass';
import { startSplitClassPreview, applySplitClass } from '../queries/previewSplitClass';
import { revertClassToVersion } from '../queries/classHistory';

describe('the Hierarchy after a class-reshaping refactoring (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));
  const ug = (): number =>
    Number(exec('(System myUserProfile symbolList indexOf: UserGlobals) printString'));

  // CcRoot -> CcMid -> CcLeafA, CcLeafB, all in UserGlobals.
  const defineFixture = (): void => {
    const def = (name: string, sup: string, ivars: string): void => {
      q.compileClassDefinition(
        session(),
        `${sup} subclass: '${name}' instVarNames: #(${ivars}) classVars: #() ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
      );
    };
    def('CcRoot', 'Object', "'rootOwn'");
    def('CcMid', 'CcRoot', "'a' 'b'");
    def('CcLeafA', 'CcMid', '');
    def('CcLeafB', 'CcMid', '');
    q.compileMethod(session(), 'CcMid', false, 'accessing', 'compute\n\t| t |\n\tt := a.\n\t^t');
    // The cache every test starts from: built before the refactoring, so it holds the old classes.
    getClassDescendantNames(exec, 'CcRoot', ug());
  };

  /** The direct subclasses the Hierarchy shows for `cls`, each as `name:binding`. `cls` is looked
   *  up in UserGlobals, except Object, which lives in Globals. */
  const subclassesOf = (cls: string): string[] =>
    getClassHierarchy(exec, cls, cls === 'Object' ? undefined : ug())
      .filter((e) => e.kind === 'subclass')
      .map((e) => `${e.className}:${e.binding}`)
      .sort();

  const current = (...names: string[]): string[] => names.map((n) => `${n}:bound`).sort();

  const runStructure = async (
    op: IvarStructureOp,
    cls: string,
    varName: string,
    extra?: ConvertTempArgs,
    move?: MoveArgs,
  ): Promise<void> => {
    const token = `cc-${op}`;
    const start = parseStructureStart(
      await startInstVarStructurePreview(
        asyncExec,
        op,
        cls,
        varName,
        token,
        PREVIEW_PAGE_BYTES,
        ug(),
        extra,
        false,
        move,
      ),
    );
    expect(start.outOfScope.decline).toBeNull();
    await applyInstVarStructure(asyncExec, token);
  };

  const runInstVar = async (op: 'add' | 'remove', varName: string): Promise<void> => {
    const token = `cc-ivar-${op}`;
    parseInstVarStart(
      await startInstVarPreview(asyncExec, op, 'CcMid', varName, token, PREVIEW_PAGE_BYTES, ug()),
    );
    await applyInstVar(asyncExec, token, [], null, false, false);
  };

  it('after pushing an instance variable up', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();

    await runStructure('pushUp', 'CcMid', 'a');

    expect(subclassesOf('Object').filter((s) => s.startsWith('CcRoot:'))).toEqual(
      current('CcRoot'),
    );
    expect(subclassesOf('CcRoot')).toEqual(current('CcMid'));
    expect(subclassesOf('CcMid')).toEqual(current('CcLeafA', 'CcLeafB'));
  }, 60_000);

  it('after pushing an instance variable down', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();

    await runStructure('pushDown', 'CcMid', 'b');

    expect(subclassesOf('CcRoot')).toEqual(current('CcMid'));
    expect(subclassesOf('CcMid')).toEqual(current('CcLeafA', 'CcLeafB'));
  }, 60_000);

  it('after moving an instance variable to one subclass', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();

    await runStructure('move', 'CcMid', 'b', undefined, {
      targets: [{ className: 'CcLeafA', dictIndex: ug() }],
      direction: 'down',
    });

    expect(subclassesOf('CcRoot')).toEqual(current('CcMid'));
    expect(subclassesOf('CcMid')).toEqual(current('CcLeafA', 'CcLeafB'));
  }, 60_000);

  it('after converting a temporary into an instance variable', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();

    await runStructure('convertTemp', 'CcMid', 't', {
      selector: 'compute',
      isMeta: false,
      varName: 't',
    });

    expect(subclassesOf('CcRoot')).toEqual(current('CcMid'));
    expect(subclassesOf('CcMid')).toEqual(current('CcLeafA', 'CcLeafB'));
  }, 60_000);

  it('after adding an instance variable', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();

    await runInstVar('add', 'c');

    expect(subclassesOf('CcRoot')).toEqual(current('CcMid'));
    expect(subclassesOf('CcMid')).toEqual(current('CcLeafA', 'CcLeafB'));
  }, 60_000);

  it('after removing an instance variable', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();

    await runInstVar('remove', 'b');

    expect(subclassesOf('CcRoot')).toEqual(current('CcMid'));
    expect(subclassesOf('CcMid')).toEqual(current('CcLeafA', 'CcLeafB'));
  }, 60_000);

  it('after renaming an instance variable', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    startRenameInstVarPreview(exec, 'CcMid', 'a', 'z', 'cc-rename-ivar', ug());

    applyRenameInstVar(exec, 'cc-rename-ivar', []);

    expect(subclassesOf('CcRoot')).toEqual(current('CcMid'));
    expect(subclassesOf('CcMid')).toEqual(current('CcLeafA', 'CcLeafB'));
  }, 60_000);

  it('after renaming a class', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    await startRenameClassPreview(
      asyncExec,
      'CcMid',
      'CcMiddle',
      { kind: 'wholeSystem' },
      {
        copyMethods: true,
        recompileSubclasses: true,
        migrateInstances: false,
        removeOldFromHistory: false,
      },
      'cc-rename-class',
      PREVIEW_PAGE_BYTES,
      ug(),
    );

    await applyRenameClass(asyncExec, 'cc-rename-class', []);

    expect(subclassesOf('CcRoot')).toEqual(current('CcMiddle'));
    expect(subclassesOf('CcMiddle')).toEqual(current('CcLeafA', 'CcLeafB'));
  }, 60_000);

  it('after inserting a superclass', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    await startExtractSuperclassPreview(
      asyncExec,
      'CcMid',
      'CcMidParent',
      [],
      { methods: [], instVars: [] },
      'cc-extract',
      PREVIEW_PAGE_BYTES,
    );

    await applyExtractSuperclass(asyncExec, 'cc-extract');

    expect(subclassesOf('CcRoot')).toEqual(current('CcMidParent'));
    expect(subclassesOf('CcMidParent')).toEqual(current('CcMid'));
    expect(subclassesOf('CcMid')).toEqual(current('CcLeafA', 'CcLeafB'));
  }, 60_000);

  it('after splitting a class', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    await startSplitClassPreview(
      asyncExec,
      'CcMid',
      'CcMidPart',
      ['b'],
      'cc-split',
      PREVIEW_PAGE_BYTES,
    );

    await applySplitClass(asyncExec, 'cc-split');

    expect(subclassesOf('CcRoot')).toEqual(current('CcMid'));
    expect(subclassesOf('CcMid')).toEqual(current('CcLeafA', 'CcLeafB'));
  }, 60_000);

  it('after restoring an earlier class version from Class History', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    // A second version to go back from. compileClassDefinition drops the cache itself, so warm it
    // again afterwards: the revert is what has to drop it.
    q.compileClassDefinition(
      session(),
      "CcRoot subclass: 'CcMid' instVarNames: #('a' 'b' 'c') classVars: #() " +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    getClassDescendantNames(exec, 'CcRoot', ug());

    revertClassToVersion(exec, 'CcMid', 1, ug());

    // A revert does not carry the subclasses across, so the version they still sit on is listed
    // too, as an old version -- that one is real. What a stale list lacks is the restored CURRENT one.
    expect(subclassesOf('CcRoot')).toContain('CcMid:bound');
  }, 60_000);
});
