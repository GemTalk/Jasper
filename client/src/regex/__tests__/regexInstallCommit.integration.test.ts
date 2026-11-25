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
import { toLocalGemPath, gsStringLiteral } from '../../serverPlugin/installHelpers';

/**
 * The regex loader when its commit is refused. Its own file because the install tests
 * beside it already book every session a file may hold. Bare-stone pass only, like them.
 */
describe('regex support install whose commit fails (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  let login: (options?: { user?: string }) => void;
  useIntegrationTest(
    (testContext) => {
      gci = testContext.gciLibrary;
      handle = testContext.session;
      login = testContext.login;
    },
    // login() keeps the session before it, so the SystemUser login adds one.
    { sessions: 2 },
  );
  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = (code: string): string => q.executeFetchString(session(), code).trim();
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const payloadDir = path.join(repoRoot, pluginFeatures.regex.payloadSubdir);

  const asSystemUser = (ctx: Parameters<typeof requireServerPluginFeatureAbsent>[1]) => {
    requireServerPluginFeatureAbsent(pluginFeatures.regex, ctx, session());
    login({ user: 'SystemUser' });
    expect(exec('System myUserProfile userId')).toBe('SystemUser');
  };

  // A commit refused by a conflict (another session installing at the same time) must not
  // read as a successful install. The subclass stands in for that conflict.
  it('reports a commit that fails, and leaves nothing installed', async (ctx) => {
    asSystemUser(ctx);
    const gemDir = toLocalGemPath(payloadDir);
    exec(
      `GsFileIn fromServerPath: ${gsStringLiteral(path.posix.join(gemDir, 'regex-loader.gs'))}. 'ok'`,
    );

    const verdict = exec(
      "| cls ldr | cls := GsRegexLoader subclass: 'GsRegexLoaderCommitRefused' " +
        'instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #() ' +
        'inDictionary: SymbolDictionary new. ' +
        "cls compileMethod: 'commit ^false' dictionaries: System myUserProfile symbolList " +
        "category: 'test' environmentId: 0. " +
        `ldr := cls new loadFromServerDir: ${gsStringLiteral(gemDir)}. ` +
        "(ldr allOk ifTrue: ['OK'] ifFalse: ['FAIL']), ' ', ldr reportString",
    );

    expect(verdict).toMatch(/^FAIL /);
    expect(verdict).toContain('[FAIL] Commit -- the commit failed');
    expect(q.checkRegexSupportAvailable(session())).toBe(false);
  }, 180_000);
});
