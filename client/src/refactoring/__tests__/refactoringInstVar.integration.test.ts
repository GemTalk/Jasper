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
 *     are reported (will-not-recompile) and dropped.
 *
 * Gated via the shared server-plugin feature gate; the engine-dependent tests run in the
 * plugin-installed pass and skip, with a reason, against a bare stone. Fully transient:
 * the harness aborts each test, so nothing is committed (migrate / delete-history, which
 * would commit, are never requested here). All emitted Smalltalk is ASCII-only for 3.6.x.
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

    parseStartPreview(
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
  });

  it('declines adding a duplicate instance variable', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();

    const analysis = parseAnalysis(
      await analyzeInstVar(asyncExec, 'add', BASE, 'count', userIndex()),
    );
    expect(analysis.decline).toBeTruthy();
  });
});
