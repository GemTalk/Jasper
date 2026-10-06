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
import { installRefactoringSupport } from '../refactoringInstall';

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
 * The install needs SystemUser (it shares the dictionary into every user's symbol
 * list) and the loader commits on success or aborts on failure. The commit budget
 * lands either in a nested transaction the harness discards afterwards, so the
 * decoy and the engine both vanish with it and nothing needs uninstalling.
 */
describe('refactoring engine install beside a dictionary that already binds RBScanner', () => {
  let gci: GciLibrary;
  let handle: unknown;
  let login: (options?: { user?: string }) => void;
  useIntegrationTest(
    (testContext) => {
      gci = testContext.gciLibrary;
      handle = testContext.session;
      login = testContext.login;
    },
    // The loader's one commit, or its one abort.
    { allowedCommits: 1 },
  );
  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = async (code: string): Promise<string> =>
    (await q.executeFetchString(session(), code)).trim();

  const DECOY = 'JasperTestDecoyRB';
  const payloadDir = path.resolve(__dirname, '..', '..', '..', '..', 'resources', 'refactoring');

  const plantDecoy = `
| d |
d := SymbolDictionary new.
d name: #${DECOY}.
Object subclass: 'RBScanner' instVarNames: #() classVars: #() classInstVars: #()
  poolDictionaries: #() inDictionary: d.
System myUserProfile insertDictionary: d at: System myUserProfile symbolList size + 1.
'ok'`;

  /** Instance- plus class-side selector count of the RBScanner bound in `dictName`. */
  const rbScannerSelectorsIn = (dictName: string) => `
| d cls |
d := System myUserProfile symbolList detect: [:x | x name == #${dictName}] ifNone: [nil].
cls := d ifNotNil: [d at: #RBScanner ifAbsent: [nil]].
cls isNil ifTrue: ['none'] ifFalse: [(cls selectors size + cls class selectors size) printString]`;

  it('binds the engine classes in GsRefactoring and leaves the decoy empty', async (ctx) => {
    await requireServerPluginFeatureAbsent(pluginFeatures.refactoring, ctx, session());
    ctx.skip(
      !pluginFeatures.refactoring.isApplicable(gci.GciTsVersion().version),
      'the refactoring engine does not support this stone version',
    );
    login({ user: 'SystemUser' });
    expect(await exec('System myUserProfile userId')).toBe('SystemUser');

    expect(await exec(plantDecoy)).toBe('ok');
    expect(await exec(rbScannerSelectorsIn(DECOY))).toBe('0');

    const result = await installRefactoringSupport(session(), payloadDir);

    expect(result.success, result.report).toBe(true);
    expect(Number(await exec(rbScannerSelectorsIn('GsRefactoring')))).toBeGreaterThan(0);
    expect(await exec(rbScannerSelectorsIn(DECOY))).toBe('0');
  }, 180_000);
});
