import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
vi.mock('vscode', () => import('../../__mocks__/vscode'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import { escapeString } from '../../queries/util';
import { startRenameClassVarPreview, applyRenameClassVar } from '../queries/previewRenameClassVar';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import { parseStartPreview, parseApplyResult } from '../renameClassVarPreview';
import type { ActiveSession } from '../../sessionManager';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';

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

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
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

  it('reports rename-class-variable engine availability matching the shared refactoring probe', () => {
    expect(rbEnginePresent()).toBe(q.checkRefactoringSupportAvailable(session()));
  });

  it('runs the rename-class-variable GS SUnit suite in-stone with zero failures', (ctx) => {
    requireServerPluginFeature('refactoring', ctx, session());

    const code = `| r |
${fileInTests()}
r := (System myUserProfile symbolList objectNamed: #GsRenameClassVariableRefactoringTest) suite run.
(r failures size + r errors size) printString`;

    expect(exec(code).trim()).toBe('0');
  });

  it('previews the rename across both sides and the subclass, and stages the class-def edit', async (ctx) => {
    requireServerPluginFeature('refactoring', ctx, session());

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
    requireServerPluginFeature('refactoring', ctx, session());

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
});
