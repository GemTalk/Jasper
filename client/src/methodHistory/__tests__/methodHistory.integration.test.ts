import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { fileInEngineTestsExpr } from '../../refactoring/__tests__/support/refactoring';

/**
 * Automatic GCI integration test for the per-method history engine
 * (GsMethodHistory). Files in the built GS SUnit payload and runs the
 * GsMethodHistoryTest suite in-stone in a single call — comprehensive engine
 * coverage that is robust on 3.6.x (a file-in compiles in-image, not one GCI
 * compile per method).
 *
 * Gated on the refactoring engine being present (a bare stone skips the body but
 * stays green), since GsMethodHistory ships in that engine. Fully transient: the
 * useIntegrationTest harness aborts each test, so the filed-in test classes and
 * anything they record are rolled back and nothing is committed. All emitted
 * Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('method history (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = (code: string): string => q.executeFetchString(session(), code);

  it('runs the method-history GS SUnit suite in-stone with zero failures', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    // File in the test classes (in-image compile — robust), then run the suite and
    // report its test count and its failure+error count.
    const code = `| r |
${fileInEngineTestsExpr()}
r := (System myUserProfile symbolList objectNamed: #GsMethodHistoryTest) suite run.
r runCount printString, ' ', (r failures size + r errors size) printString`;

    const [runCount, failed] = exec(code).trim().split(' ');
    expect(Number(runCount)).toBeGreaterThanOrEqual(10);
    expect(failed).toBe('0');
  });
});
