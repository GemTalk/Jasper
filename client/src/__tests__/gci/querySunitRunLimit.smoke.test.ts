// On-demand smoke test for runFailingTests' blocking-call guard (MAX_RUN_CLASSES).
//
// PARKED HERE DELIBERATELY. The rest of the SUnit-query smoke tests live in the
// automatic suite (`src/queries/__tests__/querySunit.integration.test.ts`);
// this one does not, because as written it cannot run in CI:
//
// Correct behavior depends on image size, so the test branches on how many
// TestCase subclasses the live stone has. Over the cap, it asserts a fast
// "narrow it" failure — cheap. Within the cap, it runs the no-args path for
// real, which executes every discovered suite inside ONE synchronous,
// un-interruptible GCI call. CI provisions a bare vendor extent (7 kernel SUnit
// self-test classes), so CI is permanently on the within-cap branch. On most
// versions those suites take ~2s; on 3.7.5 they take ~46s, which blows vitest's
// 5s default timeout — and because the GCI call is blocking, vitest can't
// actually interrupt it, so a future version that hangs would take out the whole
// job with no useful signal.
//
// Making this assertion CI-safe means removing the image-size dependency (e.g.
// tripping the guard with a bounded, deterministic class selection instead of
// whatever the stone happens to contain). That's a redesign, not a timeout bump,
// and it's scheduled as its own phase. Until then it runs on demand only:
// `npm run test:gci`.

import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { runFailingTests, MAX_RUN_CLASSES } from '../../queries/runFailingTests';
import { discoverAllTestClasses } from '../../queries/__tests__/discoverAllTestClasses';

describe('runFailingTests blocking-call guard (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);

  // A large image (over the cap) must fail fast with a "narrow it" error rather
  // than wedge the session; a small image (within the cap) simply runs what's
  // there and returns results.
  it('limits how many test classes a single run executes', () => {
    const classCount = discoverAllTestClasses(exec).length;

    if (classCount > MAX_RUN_CLASSES) {
      expect(() => runFailingTests(exec)).toThrow(/too many to run|Narrow the run/);
    } else {
      const results = runFailingTests(exec);

      expect(Array.isArray(results)).toBe(true);
    }
  });
});
