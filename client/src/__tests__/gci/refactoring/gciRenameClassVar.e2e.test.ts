// End-to-end (live GCI) test for the rename-class-variable (R4) refactoring,
// driving the real client query builders + parsers against the server-side engine.
// A deeper companion to the automatic integration test: it also proves the
// SHADOWING exclusion (a same-named block temporary is left alone) and the
// value-preservation + no-new-version guarantees end-to-end.
//
// Gated on the engine being present (a bare stone skips the body but stays green),
// so this is safe to run against any stone. Fully transient: it defines throwaway
// classes in the uncommitted transaction and aborts — nothing is ever committed.

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { HarnessSession, login } from '../queryHarness';
import {
  startRenameClassVarPreview,
  applyRenameClassVar,
} from '../../../refactoring/queries/previewRenameClassVar';
import { PREVIEW_PAGE_BYTES } from '../../../refactoring/queries/previewRenameMethod';
import { parseStartPreview, parseApplyResult } from '../../../refactoring/renameClassVarPreview';

const BASE = 'JasperCvE2EBase';

describe('rename class variable end-to-end (live GCI)', () => {
  let s: HarnessSession;
  let userIndex: number;
  const asyncExec = (code: string): Promise<string> => Promise.resolve(s.exec(code));

  const rbEnginePresent = (): boolean =>
    s
      .exec(
        "(System myUserProfile symbolList objectNamed: 'GsRenameClassVariableRefactoring') notNil printString",
      )
      .trim() === 'true';

  // A class owning the `Counter` class variable with: a genuine reference (bump),
  // and a method whose only occurrence is captured by a same-named block temporary
  // (shadow) — which must NOT be rewritten. A non-nil shared value is set on it.
  const defineFixture = (): void => {
    s.exec(
      `Object subclass: '${BASE}' instVarNames: #() classVars: #(Counter) ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals. true printString',
    );
    s.exec(
      `${BASE} compileMethod: 'bump Counter := (Counter ifNil: [0]) + 1' ` +
        "dictionaries: System myUserProfile symbolList category: 'accessing'. true printString",
    );
    // Resume the shadow warning so the fixture still installs.
    s.exec(
      `[${BASE} compileMethod: 'shadow | Counter | Counter := 5. ^Counter' ` +
        "dictionaries: System myUserProfile symbolList category: 'accessing'] " +
        'on: CompileWarning do: [:ex | ex resume: nil]. true printString',
    );
    s.exec(`(${BASE} _classVars associationAt: #Counter) value: 7. true printString`);
  };

  beforeAll(() => {
    s = login();
    userIndex = parseInt(
      s.exec(
        '| sl d | sl := System myUserProfile symbolList. ' +
          "d := sl detect: [:x | x name = #'UserGlobals'] ifNone: [nil]. " +
          '(d ifNil: [0] ifNotNil: [sl indexOf: d]) printString',
      ),
      10,
    );
  });

  afterEach(() => {
    // Discard the fixture (and any applied rename) so each test starts clean and
    // nothing is committed.
    try {
      s.exec('System abortTransaction. true printString');
    } catch {
      /* best-effort */
    }
  });

  afterAll(() => {
    s?.logout();
  });

  it('reports engine availability consistently', () => {
    expect(typeof rbEnginePresent()).toBe('boolean');
  });

  it('rewrites a genuine reference but leaves a shadowing block temporary alone', async (ctx) => {
    if (!rbEnginePresent()) ctx.skip('refactoring engine not loaded in this stone');

    defineFixture();

    const start = parseStartPreview(
      await startRenameClassVarPreview(
        asyncExec,
        BASE,
        'Counter',
        'Tally',
        `cve2e-preview-${BASE}`,
        PREVIEW_PAGE_BYTES,
        userIndex,
      ),
    );

    const bump = start.page.changes.find((c) => c.selector === 'bump');
    expect(bump?.newSource).toContain('Tally :=');
    // The fully-shadowed method accesses no class variable, so it is not staged.
    expect(start.page.changes.some((c) => c.selector === 'shadow')).toBe(false);
  });

  it('applies the rename, preserving the shared value and creating no new class version', async (ctx) => {
    if (!rbEnginePresent()) ctx.skip('refactoring engine not loaded in this stone');

    defineFixture();
    const token = `cve2e-apply-${BASE}`;
    const historyBefore = s.exec(`${BASE} classHistory size printString`).trim();

    await startRenameClassVarPreview(
      asyncExec,
      BASE,
      'Counter',
      'Tally',
      token,
      PREVIEW_PAGE_BYTES,
      userIndex,
    );
    const result = parseApplyResult(await applyRenameClassVar(asyncExec, token));

    expect(result.failed).toEqual([]);
    expect(s.exec(`(${BASE} classVarNames includes: #Tally) printString`).trim()).toBe('true');
    expect(s.exec(`(${BASE} classVarNames includes: #Counter) printString`).trim()).toBe('false');
    expect(s.exec(`(${BASE} _classVars associationAt: #Tally) value printString`).trim()).toBe('7');
    expect(s.exec(`${BASE} classHistory size printString`).trim()).toBe(historyBefore);
    // The shadowing method was never rewritten, so it still names its block temporary.
    expect(
      s.exec(`(${BASE} compiledMethodAt: #shadow environmentId: 0 otherwise: nil) sourceString`),
    ).toContain('Counter');
  });
});
