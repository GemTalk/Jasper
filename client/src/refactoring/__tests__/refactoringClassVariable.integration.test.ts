import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import { escapeString } from '../../queries/util';
import { startRenameClassVarPreview, applyRenameClassVar } from '../queries/previewRenameClassVar';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import { parseStartPreview, parseApplyResult } from '../renameClassVarPreview';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';

/**
 * Automatic GCI integration test for the rename-class-variable (R4) refactoring,
 * over the real GCI transport.
 *
 * Two layers, mirroring the rename-class integration test:
 *  1. The engine's GS SUnit suite, filed in from the built payload and run
 *     in-stone in one call.
 *  2. A client round trip through the actual query builders and parsers: preview
 *     a rename, apply it server-side, and confirm the stone was reshaped — the
 *     class variable renamed on both sides across the hierarchy, its shared VALUE
 *     preserved, and NO new class version created (the R4 crown-jewel guarantees).
 *
 * Gated on the engine being present (a bare stone skips the body but stays
 * green). Fully transient: the harness aborts each test, so nothing is committed.
 * All emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('rename class variable (integration)', () => {
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
      "(System myUserProfile symbolList objectNamed: 'GsRenameClassVariableRefactoring') notNil printString",
    ).trim() === 'true';

  const engineTestsPayload = (): string =>
    path.resolve(__dirname, '../../../../resources/refactoring/engine-tests.gs');

  const fileInTests = (): string => {
    const p = escapeString(engineTestsPayload());
    return `[GsFileIn fromServerPath: '${p}'] on: Error do: [:e | GsFileIn fromPath: '${p}' on: #serverUtf8File to: nil].`;
  };

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

  const BASE = 'RCVItBase';
  const SUB = 'RCVItSub';
  const SHADOW_BASE = 'RCVItShadowBase';

  // A base class owning the `Rate` class variable, referenced from an instance
  // method, a class-side method, and a subclass method — so the rename must reach
  // both sides across the hierarchy — with a non-nil shared value set on it.
  const defineFixture = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${BASE}' instVarNames: #() classVars: #(Rate) ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session(), BASE, false, 'accessing', 'accrue\n\t^Rate');
    q.compileMethod(session(), BASE, true, 'defaults', 'resetRate\n\tRate := 0');
    q.compileClassDefinition(
      session(),
      `${BASE} subclass: '${SUB}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session(), SUB, false, 'accessing', 'useRate\n\t^Rate');
    // End with a byte-object (String) result: executeFetchString fetches the result
    // as bytes, and `value: 42` answers the association, which is not a byte object.
    exec(`(${BASE} _classVars associationAt: #Rate) value: 42. 'ok'`);
  };

  // A separate fixture proving the SHADOWING exclusion: a class owning `Counter`
  // with a genuine reference (`bump`) and a method whose only occurrence is
  // captured by a same-named method temporary (`shadow`) — which must NOT be
  // rewritten. A non-nil shared value is set so an apply can be checked to leave
  // the shadowing method's source untouched.
  const defineShadowFixture = (): void => {
    exec(
      `Object subclass: '${SHADOW_BASE}' instVarNames: #() classVars: #(Counter) ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals. true printString',
    );
    exec(
      `${SHADOW_BASE} compileMethod: 'bump Counter := (Counter ifNil: [0]) + 1' ` +
        "dictionaries: System myUserProfile symbolList category: 'accessing'. true printString",
    );
    // Resume the shadow warning so the fixture still installs.
    exec(
      `[${SHADOW_BASE} compileMethod: 'shadow | Counter | Counter := 5. ^Counter' ` +
        "dictionaries: System myUserProfile symbolList category: 'accessing'] " +
        'on: CompileWarning do: [:ex | ex resume: nil]. true printString',
    );
    exec(`(${SHADOW_BASE} _classVars associationAt: #Counter) value: 7. true printString`);
  };

  it('reports rename-class-variable engine availability matching the shared refactoring probe', () => {
    expect(rbEnginePresent()).toBe(q.checkRefactoringSupportAvailable(session()));
  });

  it('runs the rename-class-variable GS SUnit suite in-stone with zero failures', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const code = `| r |
${fileInTests()}
r := (System myUserProfile symbolList objectNamed: #GsRenameClassVariableRefactoringTest) suite run.
(r failures size + r errors size) printString`;

    expect(exec(code).trim()).toBe('0');
  });

  it('previews the rename across both sides and the subclass, and stages the class-def edit', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();

    const start = parseStartPreview(
      await startRenameClassVarPreview(
        asyncExec,
        BASE,
        'Rate',
        'Multiplier',
        `rcvit-${BASE}`,
        PREVIEW_PAGE_BYTES,
        userIndex(),
      ),
    );

    expect(start.oldName).toBe('Rate');
    expect(start.newName).toBe('Multiplier');
    const def = start.page.changes.find((c) => c.kind === 'classDefinitionEdit');
    expect(def?.newSource).toContain('Multiplier');
    expect(def?.newSource).not.toContain('Rate');
    const accrue = start.page.changes.find((c) => c.selector === 'accrue');
    expect(accrue?.newSource).toContain('^Multiplier');
    const resetRate = start.page.changes.find((c) => c.selector === 'resetRate');
    expect(resetRate?.isMeta).toBe(true);
    const useRate = start.page.changes.find((c) => c.selector === 'useRate');
    expect(useRate?.className).toBe(SUB);
  });

  it('applies the rename server-side, preserving the value and creating no new version', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `rcvit-apply-${BASE}`;
    const historyBefore = exec(`${BASE} classHistory size printString`).trim();

    await startRenameClassVarPreview(
      asyncExec,
      BASE,
      'Rate',
      'Multiplier',
      token,
      PREVIEW_PAGE_BYTES,
      userIndex(),
    );
    const result = parseApplyResult(await applyRenameClassVar(asyncExec, token));

    expect(result.failed).toEqual([]);
    expect(exec(`(${BASE} classVarNames includes: #Multiplier) printString`).trim()).toBe('true');
    expect(exec(`(${BASE} classVarNames includes: #Rate) printString`).trim()).toBe('false');
    // The shared value carried across (a naive class-def recompile would drop it).
    expect(exec(`(${BASE} _classVars associationAt: #Multiplier) value printString`).trim()).toBe(
      '42',
    );
    // A class-variable change makes no new class version — the [n] tag is unchanged.
    expect(exec(`${BASE} classHistory size printString`).trim()).toBe(historyBefore);
    // References were rewritten, both sides and in the subclass.
    expect(
      exec(`(${BASE} compiledMethodAt: #accrue environmentId: 0 otherwise: nil) sourceString`),
    ).toContain('Multiplier');
    expect(
      exec(`(${SUB} compiledMethodAt: #useRate environmentId: 0 otherwise: nil) sourceString`),
    ).toContain('Multiplier');
  });

  it('rewrites a genuine reference but leaves a shadowing method temporary unstaged in the preview', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineShadowFixture();

    const start = parseStartPreview(
      await startRenameClassVarPreview(
        asyncExec,
        SHADOW_BASE,
        'Counter',
        'Tally',
        `rcvit-shadow-${SHADOW_BASE}`,
        PREVIEW_PAGE_BYTES,
        userIndex(),
      ),
    );

    const bump = start.page.changes.find((c) => c.selector === 'bump');
    expect(bump?.newSource).toContain('Tally :=');
    // The fully-shadowed method accesses no class variable, so it is not staged.
    expect(start.page.changes.some((c) => c.selector === 'shadow')).toBe(false);
  });

  it('leaves the shadowing method source unchanged after applying the rename', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineShadowFixture();
    const token = `rcvit-shadow-apply-${SHADOW_BASE}`;

    await startRenameClassVarPreview(
      asyncExec,
      SHADOW_BASE,
      'Counter',
      'Tally',
      token,
      PREVIEW_PAGE_BYTES,
      userIndex(),
    );
    const result = parseApplyResult(await applyRenameClassVar(asyncExec, token));

    expect(result.failed).toEqual([]);
    // The shadowing method was never rewritten, so it still names its own temporary.
    expect(
      exec(
        `(${SHADOW_BASE} compiledMethodAt: #shadow environmentId: 0 otherwise: nil) sourceString`,
      ),
    ).toContain('Counter');
  });

  // ---- inherited-classvar retarget resolution (#328 item 11) ------------------
  // Invoked on a class variable a subclass method only INHERITS, the editor rename
  // command resolves the defining class and reruns the rename there. That
  // resolution is getDefiningClassOfClassVar; prove it against the real hierarchy so
  // the superclass walk + SymbolList-index lookup are exercised on a stone.

  it('resolves a class variable inherited by a subclass to its defining class and dictionary', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();

    expect(q.getDefiningClassOfClassVar(session(), SUB, 'Rate', userIndex())).toEqual({
      className: BASE,
      dictIndex: userIndex(),
    });
  });

  it('resolves a class variable to its declaring class even when asked from that class', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();

    expect(q.getDefiningClassOfClassVar(session(), BASE, 'Rate', userIndex())?.className).toBe(
      BASE,
    );
  });

  it('answers undefined for a word that is not a visible class variable', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();

    expect(
      q.getDefiningClassOfClassVar(session(), SUB, 'NotAClassVar', userIndex()),
    ).toBeUndefined();
  });

  it('renames an inherited class variable across the hierarchy when retargeted to its defining class', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    // Resolve the defining class the way the editor command does when the cursor is
    // on `Rate` in a SUB method, then run the rename against THAT class.
    const defining = q.getDefiningClassOfClassVar(session(), SUB, 'Rate', userIndex());
    if (!defining) throw new Error('expected Rate to resolve to its defining class');
    const token = `rcvit-retarget-${BASE}`;

    await startRenameClassVarPreview(
      asyncExec,
      defining.className,
      'Rate',
      'Multiplier',
      token,
      PREVIEW_PAGE_BYTES,
      defining.dictIndex,
    );
    const result = parseApplyResult(await applyRenameClassVar(asyncExec, token));

    expect(result.failed).toEqual([]);
    expect(exec(`(${BASE} classVarNames includes: #Multiplier) printString`).trim()).toBe('true');
    // The inherited-referencing subclass method now reads the renamed class variable.
    expect(
      exec(`(${SUB} compiledMethodAt: #useRate environmentId: 0 otherwise: nil) sourceString`),
    ).toContain('Multiplier');
  });
});
