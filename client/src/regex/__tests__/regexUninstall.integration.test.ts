import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as path from 'path';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';
import {
  requireServerPluginFeature,
  requireServerPluginFeatureAbsent,
} from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { installRegexSupport } from '../regexInstall';
import { uninstallRegexSupport } from '../regexUninstall';

/**
 * Removing regex support from a real stone.
 *
 * The plugin-pass tests detach the dictionary from this user only and never commit,
 * so the support is intact for later files. The bare-pass test runs the real
 * uninstall over SystemUser: install, then remove, each committing into a nested
 * transaction the harness discards.
 */
describe('regex support uninstall (integration)', () => {
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
    { allowedCommits: 2, sessions: 3 },
  );
  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = (code: string): string => q.executeFetchString(session(), code).trim();
  const payloadDir = path.resolve(__dirname, '..', '..', '..', '..', 'resources', 'regex');

  const detachFromThisUser = `
| prof list idx |
prof := System myUserProfile.
list := prof symbolList.
idx := (1 to: list size) detect: [:i | (list at: i) name == #GsRegexLibrary] ifNone: [nil].
idx notNil ifTrue: [ prof removeDictionaryAt: idx ].
'ok'`;

  it('flips the availability probe to false when GsRegexLibrary leaves the symbol list', (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    expect(q.checkRegexSupportAvailable(session())).toBe(true);

    exec(detachFromThisUser);

    expect(q.checkRegexSupportAvailable(session())).toBe(false);
  });

  it('removes the dictionary from every user, empties it, and removes the loader', async (ctx) => {
    requireServerPluginFeatureAbsent(pluginFeatures.regex, ctx, session());
    login({ user: 'SystemUser' });
    const installed = await installRegexSupport(session(), payloadDir);
    expect(installed.success, installed.report).toBe(true);
    exec(
      "UserGlobals at: #JasperTestRegexLibrary put: (System myUserProfile symbolList detect: [:d | d name == #GsRegexLibrary]). 'ok'",
    );

    const result = await uninstallRegexSupport(session());

    expect(result).toMatchObject({ success: true, committed: true, verified: true });
    expect(
      exec(
        '(AllUsers anySatisfy: [:u | (u symbolList detect: [:d | d name == #GsRegexLibrary] ifNone: [nil]) notNil]) printString',
      ),
    ).toBe('false');
    expect(exec('(UserGlobals at: #JasperTestRegexLibrary) size printString')).toBe('0');
    expect(exec('(UserGlobals includesKey: #GsRegexLoader) printString')).toBe('false');
  }, 300_000);

  it('succeeds and changes nothing on a stone that never had it', async (ctx) => {
    requireServerPluginFeatureAbsent(pluginFeatures.regex, ctx, session());
    login({ user: 'SystemUser' });

    const result = await uninstallRegexSupport(session());

    expect(result).toMatchObject({ success: true, verified: true });
  });
});
