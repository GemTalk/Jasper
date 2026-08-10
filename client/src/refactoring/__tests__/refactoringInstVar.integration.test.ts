import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import { escapeString } from '../../queries/util';
import { analyzeInstVar, startInstVarPreview, applyInstVar } from '../queries/previewInstVar';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import { parseAnalysis, parseStartPreview, parseApplyResult } from '../instVarRefactorPreview';
import type { ActiveSession } from '../../sessionManager';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';

/**
 * Automatic GCI integration test for the add / remove instance-variable (V1) refactoring,
 * over the real GCI transport.
 *
 * Two layers, mirroring the other refactoring integration tests:
 *  1. The engine's GS SUnit suite, filed in from the built payload and run in-stone.
 *  2. A client round trip through the real query builders + parsers: add an ivar and
 *     confirm the class carries it; remove one that methods use and confirm those methods
 *     are reported (will-not-recompile) and dropped while an unrelated method survives;
 *     stop at the first failure of a partial apply without aborting; predict a shadowed
 *     temporary; and decline a name a subclass already declares.
 *
 * The committing paths (migrate instances, delete history) cannot live here — on those the
 * engine itself commits, and the harness aborts after every test, which cannot undo a commit
 * — so they stay in `__tests__/gci/gciInstVar.e2e.test.ts`.
 *
 * Gated via the shared server-plugin feature gate; the engine-dependent tests run in the
 * plugin-installed pass and skip, with a reason, against a bare stone. Fully transient:
 * the harness aborts each test, and neither migrate nor delete-history is ever requested
 * here. All emitted Smalltalk is ASCII-only for 3.6.x.
 */
describe('add / remove instance variable (integration)', () => {
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
      '(System myUserProfile symbolList objectNamed: #GsInstVarRefactoring) notNil printString',
    ).trim() === 'true';

  const engineTestsPayload = (): string =>
    path.resolve(__dirname, '../../../../resources/refactoring/engine-tests.gs');

  const fileInTests = (): string => {
    const p = escapeString(engineTestsPayload());
    return `[GsFileIn fromServerPath: '${p}'] on: Error do: [:e | GsFileIn fromPath: '${p}' on: #serverUtf8File to: nil].`;
  };

  const userIndex = (): number =>
    parseInt(
      exec(
        `| sl d | sl := System myUserProfile symbolList. ` +
          `d := sl detect: [:x | x name = #'UserGlobals'] ifNone: [nil]. ` +
          `(d ifNil: [0] ifNotNil: [sl indexOf: d]) printString`,
      ),
      10,
    );

  const BASE = 'XIvItBase';
  const SUB = 'XIvItSub';

  const hasIvar = (cls: string, name: string): boolean =>
    exec(`(${cls} instVarNames includes: #${name}) printString`).trim() === 'true';
  const includesSelector = (cls: string, sel: string): boolean =>
    exec(`(${cls} includesSelector: #${sel}) printString`).trim() === 'true';

  const defineFixture = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${BASE}' instVarNames: #(count other) classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileClassDefinition(
      session(),
      `${BASE} subclass: '${SUB}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session(), BASE, false, 'accessing', 'combine\n\t^ count + other');
    // Deliberately touches `other` only, never `count` — the control for the selective
    // copy-forward assertion in the remove test: removing `count` must NOT drop this.
    q.compileMethod(session(), BASE, false, 'accessing', 'getOther\n\t^ other');
    q.compileMethod(session(), SUB, false, 'accessing', 'doubleCount\n\t^ count * 2');
  };

  it('reports instVar-refactor engine availability matching the shared refactoring probe', () => {
    expect(enginePresent()).toBe(q.checkRefactoringSupportAvailable(session()));
  });

  it('runs the instance-variable GS SUnit suite in-stone with zero failures', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const code = `| r |
${fileInTests()}
r := (System myUserProfile symbolList objectNamed: #GsInstVarRefactoringTest) suite run.
(r failures size + r errors size) printString`;

    expect(exec(code).trim()).toBe('0');
  });

  it('adds an instance variable to the class definition', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();

    const analysis = parseAnalysis(
      await analyzeInstVar(asyncExec, 'add', BASE, 'tally', userIndex()),
    );
    expect(analysis.decline).toBeNull();
    expect(analysis.affectedCount).toBe(2);

    const start = parseStartPreview(
      await startInstVarPreview(
        asyncExec,
        'add',
        BASE,
        'tally',
        'xivit-add',
        PREVIEW_PAGE_BYTES,
        userIndex(),
      ),
    );
    expect(start.total).toBe(2); // base + sub are both re-versioned
    const result = parseApplyResult(
      await applyInstVar(asyncExec, 'xivit-add', [], null, false, false),
    );
    expect(result.failed).toEqual([]);
    expect(result.committed).toBe(false);
    expect(hasIvar(BASE, 'tally')).toBe(true);
  });

  it('removes an instance variable, reporting and dropping the methods that used it', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();

    const start = parseStartPreview(
      await startInstVarPreview(
        asyncExec,
        'remove',
        BASE,
        'count',
        'xivit-remove',
        PREVIEW_PAGE_BYTES,
        userIndex(),
      ),
    );
    expect(start.outOfScope.willNotRecompile.map((m) => m.selector)).toEqual(
      expect.arrayContaining(['combine', 'doubleCount']),
    );

    const result = parseApplyResult(
      await applyInstVar(asyncExec, 'xivit-remove', [], null, false, false),
    );
    expect(result.dropped.map((m) => m.selector)).toEqual(
      expect.arrayContaining(['combine', 'doubleCount']),
    );
    expect(hasIvar(BASE, 'count')).toBe(false);
    expect(includesSelector(BASE, 'combine')).toBe(false);

    // Copy-forward is SELECTIVE, not all-or-nothing: `getOther` never referenced `count`,
    // so it must survive onto the new class version and must not be reported as dropped.
    expect(includesSelector(BASE, 'getOther')).toBe(true);
    expect(result.dropped.map((m) => m.selector)).not.toContain('getOther');
  });

  it('stops at the first failure and reports the partial apply without aborting', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    // Its own fixture, kept apart from the shared one: this test deletes the subclass.
    const FAIL_BASE = 'XIvItFailBase';
    const FAIL_SUB = 'XIvItFailSub';
    q.compileClassDefinition(
      session(),
      `Object subclass: '${FAIL_BASE}' instVarNames: #(x) classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileClassDefinition(
      session(),
      `${FAIL_BASE} subclass: '${FAIL_SUB}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    // A method that WOULD be dropped by the apply, so a bogus `dropped` report is detectable.
    q.compileMethod(session(), FAIL_SUB, false, 'accessing', 'shadowIt | tally | ^tally');
    // A pre-existing method on the base, unrelated to `tally`, so its copy-forward survival
    // on the class that actually re-versions during this partial apply is exercised too —
    // not just on a clean, fully-successful apply.
    q.compileMethod(session(), FAIL_BASE, false, 'accessing', 'keepMe\n\t^ x');

    const start = parseStartPreview(
      await startInstVarPreview(
        asyncExec,
        'add',
        FAIL_BASE,
        'tally',
        'xivit-partial-apply',
        PREVIEW_PAGE_BYTES,
        userIndex(),
      ),
    );
    expect(start.total).toBe(2); // base + sub are both staged

    // Break the SECOND change after the preview was staged: the base will version fine, then
    // the sub will fail with 'Class not found'. The session sees its own uncommitted removal.
    exec(`UserGlobals removeKey: #${FAIL_SUB} ifAbsent: []. 'ok'`);

    const result = parseApplyResult(
      await applyInstVar(asyncExec, 'xivit-partial-apply', [], null, false, false),
    );

    expect(result.failed.length).toBe(1);
    expect(result.failed[0].label).toBe(FAIL_SUB);
    expect(result.applied).toBe(1); // the base applied; the sub failed; nothing after it ran
    expect(result.dropped).toEqual([]); // shadowIt never ran, so it must not be reported dropped
    expect(result.partiallyApplied).toBe(true);
    expect(result.committed).toBe(false);
    // The decisive check: the engine did NOT abort, so the base's new version is still staged
    // in the transaction — which is exactly why the client tells the user to abort it.
    expect(hasIvar(FAIL_BASE, 'tally')).toBe(true);
    // Copy-forward survival on the class that actually succeeded mid-partial-apply: `keepMe`
    // predates this apply and never referenced `tally`, so it must ride along onto the base's
    // new version just as it would on a clean, fully-successful apply.
    expect(includesSelector(FAIL_BASE, 'keepMe')).toBe(true);
  });

  it('warns up front that a method whose temp shadows the new variable will not recompile', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    // A SUB method with a METHOD-LEVEL temporary named `tally`: once `tally` becomes an
    // inherited instance variable, that declaration shadows it. The preview must surface the
    // method up front so it is not silently dropped at apply.
    //
    // This asserts the PREDICTION only, not an apply drop: whether the shadowed recompile
    // hard-fails or merely warns can vary by stone/version, but the source-based prediction is
    // deterministic and is the contract this covers. (The apply-drops-exactly-the-predicted-
    // method invariant is pinned in the GS SUnit suite above.)
    q.compileMethod(
      session(),
      SUB,
      false,
      'accessing',
      'shadowsTally\n\t| tally |\n\ttally := 1.\n\t^ tally',
    );

    const start = parseStartPreview(
      await startInstVarPreview(
        asyncExec,
        'add',
        BASE,
        'tally',
        'xivit-add-shadow',
        PREVIEW_PAGE_BYTES,
        userIndex(),
      ),
    );

    const shadowed = start.outOfScope.willNotRecompile.find((m) => m.selector === 'shadowsTally');
    expect(shadowed).toBeDefined();
    expect(shadowed?.className).toBe(SUB);
    // A sibling method that only USES another ivar (`count`) must not be over-reported.
    expect(start.outOfScope.willNotRecompile.map((m) => m.selector)).not.toContain('doubleCount');
  });

  it('declines a name a subclass already declares, naming the subclass, before any preview', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    q.compileClassDefinition(
      session(),
      `Object subclass: '${BASE}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileClassDefinition(
      session(),
      `${BASE} subclass: '${SUB}' instVarNames: #(mine) classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );

    const analysis = parseAnalysis(
      await analyzeInstVar(asyncExec, 'add', BASE, 'mine', userIndex()),
    );

    expect(analysis.decline).toBeDefined();
    expect(analysis.decline).toContain(SUB);
  });

  it('declines adding a duplicate instance variable', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();

    const analysis = parseAnalysis(
      await analyzeInstVar(asyncExec, 'add', BASE, 'count', userIndex()),
    );
    expect(analysis.decline).toBeDefined();
  });
});
