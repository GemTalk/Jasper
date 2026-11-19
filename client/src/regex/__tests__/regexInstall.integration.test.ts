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
import { pluginStatus, readJasperVersion } from '../../serverPlugin/pluginFingerprint';
import { toLocalGemPath, gsStringLiteral } from '../../serverPlugin/installHelpers';
import { installRegexSupport } from '../regexInstall';
import { REGEX_RECEIPT } from '../regexPayload';

/**
 * Installing regex support into a real stone, the way Jasper's command and CI do.
 *
 * Runs in the bare-stone pass only: each test starts from a stone without the
 * support. Every commit the loader makes lands in a nested transaction the harness
 * discards, so the stone is bare again for the next test and for the next file.
 */
describe('regex support install (integration)', () => {
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
    { allowedCommits: 2, sessions: 8 },
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

  /** Where the class bound to `name` lives, by dictionary name, or 'none'. */
  const homeOf = (name: string) =>
    exec(
      `(System myUserProfile symbolList dictionaryAndSymbolOf: ` +
        `(System myUserProfile symbolList objectNamed: '${name}')) ` +
        `ifNil: ['none'] ifNotNil: [:da | (da at: 1) name]`,
    );

  it('installs, passes every completeness check, and is then detected', async (ctx) => {
    asSystemUser(ctx);

    const result = await installRegexSupport(session(), payloadDir);

    expect(result.success, result.report).toBe(true);
    expect(result.report).toContain('SUCCESS');
    expect(result.report).not.toContain('[FAIL]');
    expect(q.checkRegexSupportAvailable(session())).toBe(true);
  }, 180_000);

  it('puts every class in its own GsRegexLibrary dictionary, at the end of the symbol list', async (ctx) => {
    asSystemUser(ctx);

    const result = await installRegexSupport(session(), payloadDir);
    expect(result.success, result.report).toBe(true);

    for (const name of ['GsRegex', 'GsRegexSourceSearch', 'GsRxParser', 'GsRxMatcher']) {
      expect(homeOf(name), name).toBe('GsRegexLibrary');
    }
    expect(exec('System myUserProfile symbolList last name')).toBe('GsRegexLibrary');
    // The loader itself is a load-time tool and stays out of the library's dictionary.
    expect(homeOf('GsRegexLoader')).toBe('UserGlobals');
  }, 180_000);

  it('shares the dictionary into every user, so DataCurator sees it too', async (ctx) => {
    asSystemUser(ctx);

    const result = await installRegexSupport(session(), payloadDir);
    expect(result.success, result.report).toBe(true);

    const missing = exec(
      '(AllUsers select: [:u | (u symbolList detect: [:d | d name == #GsRegexLibrary] ifNone: [nil]) isNil]) ' +
        "inject: '' into: [:acc :u | acc, u userId, ' ']",
    );
    expect(missing).toBe('');
  }, 180_000);

  it('adds no method to any kernel class', async (ctx) => {
    asSystemUser(ctx);
    const countKernelMethods =
      '(Globals select: [:v | v isBehavior]) inject: 0 into: [:n :c | n + c selectors size + c class selectors size]';
    const before = exec(`(${countKernelMethods}) printString`);

    const result = await installRegexSupport(session(), payloadDir);
    expect(result.success, result.report).toBe(true);

    expect(exec(`(${countKernelMethods}) printString`)).toBe(before);
  }, 180_000);

  it('reinstalls over itself and stays current', async (ctx) => {
    asSystemUser(ctx);

    const first = await installRegexSupport(session(), payloadDir);
    expect(first.success, first.report).toBe(true);
    const second = await installRegexSupport(session(), payloadDir);
    expect(second.success, second.report).toBe(true);

    expect(pluginStatus(session(), true, payloadDir, REGEX_RECEIPT)).toEqual({
      state: 'current',
      installedBy: readJasperVersion(repoRoot),
    });
  }, 300_000);

  it('leaves no receipt when loaded by hand, as the topaz bootstrap does', async (ctx) => {
    asSystemUser(ctx);
    const gemDir = toLocalGemPath(payloadDir);
    const loader = path.posix.join(gemDir, 'regex-loader.gs');
    exec(`GsFileIn fromServerPath: ${gsStringLiteral(loader)}. 'ok'`);

    const verdict = exec(
      `| ldr | ldr := GsRegexLoader loadFromServerDir: ${gsStringLiteral(gemDir)}. ` +
        "ldr allOk ifTrue: ['OK'] ifFalse: [ldr reportString]",
    );

    expect(verdict).toBe('OK');
    expect(pluginStatus(session(), true, payloadDir, REGEX_RECEIPT)).toMatchObject({
      state: 'unknown',
      unknownReason: 'noReceipt',
    });
  }, 180_000);

  it('reports a payload the gem cannot read, without touching the stone', async (ctx) => {
    asSystemUser(ctx);

    const result = await installRegexSupport(session(), path.join(repoRoot, 'no-such-payload'));

    expect(result.success).toBe(false);
    expect(result.message).toContain('cannot read');
    expect(q.checkRegexSupportAvailable(session())).toBe(false);
  });
});
