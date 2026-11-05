import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as path from 'path';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';
import { PLUGIN_FEATURES } from '../pluginFeatures';
import { pluginStatus, readJasperVersion } from '../pluginFingerprint';

/**
 * A real install stores a receipt that the status check then reads as current.
 * The receipt is written and read by Smalltalk built in TypeScript, which the
 * unit tests only see as strings; this is what proves it compiles and runs on
 * each supported release.
 *
 * Each feature's install commits once, into a nested transaction the harness
 * discards, so the stone is left as it was.
 */
describe('server plugin receipts (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  let login: (options?: { user?: string }) => void;
  useIntegrationTest(
    (testContext) => {
      gci = testContext.gciLibrary;
      handle = testContext.session;
      login = testContext.login;
    },
    { allowedCommits: 1 },
  );
  const session = (): ActiveSession => testActiveSession(gci, handle);
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

  for (const feature of PLUGIN_FEATURES) {
    it(`${feature.label} reads as current, installed by this Jasper, right after an install`, async (ctx) => {
      ctx.skip(
        !feature.isApplicable(gci.GciTsVersion().version),
        `${feature.label} does not support this stone version`,
      );
      login({ user: 'SystemUser' });
      const payloadDir = path.join(repoRoot, feature.payloadSubdir);

      const result = await feature.install(session(), payloadDir);
      expect(result.success, result.report ?? result.message).toBe(true);

      const jasperVersion = readJasperVersion(repoRoot);
      expect(pluginStatus(session(), true, payloadDir, feature.receipt)).toEqual({
        state: 'current',
        installedBy: jasperVersion,
      });
    }, 300_000);
  }
});
