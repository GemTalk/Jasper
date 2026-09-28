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
import { loginAsSystemUser, DEFAULT_SYSTEMUSER_PW } from '../../serverPlugin/installHelpers';
import { installRefactoringSupport } from '../refactoringInstall';
import { uninstallRefactoringSupport } from '../refactoringUninstall';

/**
 * A real engine install on a stone where another dictionary already binds one of
 * the engine's class names. The engine's file-in names its classes as barewords,
 * so without GsRefactoringLoader>>withDictionaryFirstDo: putting GsRefactoring
 * first in the symbol list, `RBScanner` resolves to the decoy and the engine's
 * methods are compiled into it (https://github.com/GemTalk/Jasper/issues/630).
 * CI installs only on a base extent, where nothing else binds those names, so no
 * other test would notice that fix being deleted.
 *
 * Only a FRESH install reproduces it: an existing GsRefactoring already binds a
 * full RBScanner that shadows a decoy added after it. So this runs in the
 * bare-stone pass and skips once the engine is present.
 *
 * The loader commits, and the harness's sessions refuse commits, so the work runs
 * on a SystemUser session of its own and is torn down unconditionally: the decoy
 * removed and the engine uninstalled, both committed. Either one left behind would
 * change every later test in the run.
 */
describe('refactoring engine install beside a dictionary that already binds RBScanner', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });
  const session = (): ActiveSession => testActiveSession(gci, handle);

  const DECOY = 'JasperTestDecoyRB';
  const payloadDir = path.resolve(__dirname, '..', '..', '..', '..', 'resources', 'refactoring');
  const exec = (s: ActiveSession, code: string): string => q.executeFetchString(s, code).trim();

  const plantDecoy = `
| d |
d := SymbolDictionary new.
d name: #${DECOY}.
Object subclass: 'RBScanner' instVarNames: #() classVars: #() classInstVars: #()
  poolDictionaries: #() inDictionary: d.
System myUserProfile insertDictionary: d at: System myUserProfile symbolList size + 1.
System commitTransaction printString`;

  const removeDecoy = `
| prof idx |
prof := System myUserProfile.
[idx := (1 to: prof symbolList size) detect: [:i | (prof symbolList at: i) name == #${DECOY}] ifNone: [nil].
 idx notNil] whileTrue: [prof removeDictionaryAt: idx].
System commitTransaction printString`;

  /** Instance- plus class-side selector count of the RBScanner bound in `dictName`. */
  const rbScannerSelectorsIn = (dictName: string) => `
| d cls |
d := System myUserProfile symbolList detect: [:x | x name == #${dictName}] ifNone: [nil].
cls := d ifNotNil: [d at: #RBScanner ifAbsent: [nil]].
cls isNil ifTrue: ['none'] ifFalse: [(cls selectors size + cls class selectors size) printString]`;

  it('binds the engine classes in GsRefactoring and leaves the decoy empty', async (ctx) => {
    requireServerPluginFeatureAbsent(pluginFeatures.refactoring, ctx, session());
    ctx.skip(
      !pluginFeatures.refactoring.isApplicable(gci.GciTsVersion().version),
      'the refactoring engine does not support this stone version',
    );
    let sys: ActiveSession;
    try {
      sys = loginAsSystemUser(session(), DEFAULT_SYSTEMUSER_PW);
    } catch (e) {
      return ctx.skip(`no SystemUser login on this stone: ${String(e)}`);
    }

    let decoyRemoved: string;
    let uninstalled: { success: boolean; message: string };
    let engineLeftBehind: boolean | undefined;
    try {
      expect(exec(sys, plantDecoy)).toBe('true');
      expect(exec(sys, rbScannerSelectorsIn(DECOY))).toBe('0');

      const result = await installRefactoringSupport(sys, payloadDir);

      expect(result.success, result.report).toBe(true);
      expect(Number(exec(sys, rbScannerSelectorsIn('GsRefactoring')))).toBeGreaterThan(0);
      expect(exec(sys, rbScannerSelectorsIn(DECOY))).toBe('0');
    } finally {
      try {
        exec(sys, 'System abortTransaction. true printString');
        decoyRemoved = exec(sys, removeDecoy);
      } catch (e) {
        decoyRemoved = String(e);
      }
      uninstalled = await uninstallRefactoringSupport(sys);
      // Asked on this session: the harness's is still in a transaction opened before
      // the install, so it could not see the engine either way.
      engineLeftBehind = q.checkRefactoringSupportAvailable(sys);
      gci.logout(sys.handle);
    }
    expect(decoyRemoved, 'the decoy dictionary was not removed').toBe('true');
    expect(uninstalled.success, uninstalled.message).toBe(true);
    expect(engineLeftBehind).toBe(false);
  }, 180_000);
});
