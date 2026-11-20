import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as path from 'path';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';
import { requireServerPluginFeatureAbsent } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { installRegexSupport } from '../regexInstall';

/**
 * Installing regex support into a stone that already has a regex library of its own.
 *
 * GsDevKit and GLASS stones often have the original GLASS Regex loaded, with classes
 * named RxParser, RxMatcher and so on. Jasper's copy is renamed (GsRx*) and kept in
 * its own dictionary so it can neither overwrite those classes nor be overwritten
 * by them. The second test plants a class under one of Jasper's own names, the case
 * GsRegexLoader>>withDictionaryFirstDo: exists for.
 *
 * Runs in the bare-stone pass only (a fresh install is what can go wrong); each
 * install's commit lands in a nested transaction the harness discards.
 */
describe('regex support install beside another regex library (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  let login: (options?: { user?: string }) => void;
  useIntegrationTest(
    (testContext) => {
      gci = testContext.gciLibrary;
      handle = testContext.session;
      login = testContext.login;
    },
    // login() keeps the session before it, so each test's SystemUser login adds one.
    { allowedCommits: 1, sessions: 3 },
  );
  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = (code: string): string => q.executeFetchString(session(), code).trim();
  const payloadDir = path.resolve(__dirname, '..', '..', '..', '..', 'resources', 'regex');
  const DECOY = 'JasperTestDecoyRegex';

  /** A dictionary at the end of the symbol list binding `className` to a class with one method. */
  const plantDecoy = (className: string) => `
| d cls |
d := SymbolDictionary new.
d name: #${DECOY}.
cls := Object subclass: '${className}' instVarNames: #() classVars: #() classInstVars: #()
  poolDictionaries: #() inDictionary: d.
cls compileMethod: 'decoyMarker ^42' dictionaries: System myUserProfile symbolList category: 'decoy'.
System myUserProfile insertDictionary: d at: System myUserProfile symbolList size + 1.
'ok'`;

  /** The selectors of the class `dictName` binds to `className`, space-separated, or 'none'. */
  const selectorsIn = (dictName: string, className: string) => `
| d cls |
d := System myUserProfile symbolList detect: [:x | x name == #${dictName}] ifNone: [nil].
cls := d ifNotNil: [d at: #${className} ifAbsent: [nil]].
cls isNil
  ifTrue: ['none']
  ifFalse: [(cls selectors asSortedCollection: [:a :b | a <= b]) inject: '' into: [:acc :s | acc, s, ' ']]`;

  const installAsSystemUser = async (
    ctx: Parameters<typeof requireServerPluginFeatureAbsent>[1],
  ) => {
    requireServerPluginFeatureAbsent(pluginFeatures.regex, ctx, session());
    login({ user: 'SystemUser' });
    expect(exec('System myUserProfile userId')).toBe('SystemUser');
  };

  it("leaves a stone's own RxParser untouched (the original GLASS name)", async (ctx) => {
    await installAsSystemUser(ctx);
    expect(exec(plantDecoy('RxParser'))).toBe('ok');

    const result = await installRegexSupport(session(), payloadDir);

    expect(result.success, result.report).toBe(true);
    expect(exec(selectorsIn(DECOY, 'RxParser'))).toBe('decoyMarker');
    expect(exec("(GsRegex matches: 'at:put:' pattern: 'at:put:') printString")).toBe('true');
  }, 180_000);

  it('binds its classes in GsRegexLibrary even when another dictionary has one of their names', async (ctx) => {
    await installAsSystemUser(ctx);
    expect(exec(plantDecoy('GsRxParser'))).toBe('ok');

    const result = await installRegexSupport(session(), payloadDir);

    expect(result.success, result.report).toBe(true);
    expect(exec(selectorsIn(DECOY, 'GsRxParser'))).toBe('decoyMarker');
    expect(exec(selectorsIn('GsRegexLibrary', 'GsRxParser'))).toContain('parse:');
  }, 180_000);
});
