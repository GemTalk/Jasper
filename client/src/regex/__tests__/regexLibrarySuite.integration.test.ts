import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as path from 'path';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { gsStringLiteral, toLocalGemPath } from '../../serverPlugin/installHelpers';

/**
 * The regex library's own Smalltalk tests, and Jasper's, run in the stone against
 * the support as installed (the plugin pass).
 *
 * The counts are exact. A build step that silently dropped a test, or a vendored
 * test that stopped being picked up, changes a count and fails here; "every test
 * that ran passed" alone would not notice either.
 *
 * regex-tests.gs is filed in inside the test's own transaction, which the harness
 * aborts, so nothing is left behind. It is compiled each time, hence the timeout.
 */
const EXPECTED: Record<string, number> = {
  // The library's tests, vendored from GLASS: 173 upstream, less the one removed (PROVENANCE.md).
  GsRxMatcherTest: 172,
  GsRxParserTest: 15,
  // Jasper's.
  GsRegexTest: 16,
  GsRegexSourceSearchTest: 12,
};

describe("the regex library's test suite (integration)", () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });
  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = (code: string): string => q.executeFetchString(session(), code).trim();
  const testsPayload = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'resources',
    'regex',
    'regex-tests.gs',
  );

  /** "run passed" plus one line per test that did not pass, for the failure message. */
  const runSuite = (className: string) => `
| ws pass run |
ws := WriteStream on: String new.
pass := 0. run := 0.
(${className} selectors select: [:s | (s beginsWith: 'test') and: [s numArgs = 0]]) asSortedCollection do: [:sel | | tc msg |
  run := run + 1.
  tc := ${className} selector: sel.
  msg := [tc setUp. [tc perform: sel] ensure: [tc tearDown]. nil]
    on: Error, TestResult failure do: [:e | e return: e class name, ' ', (e messageText ifNil: ['']) asString].
  msg isNil ifTrue: [pass := pass + 1] ifFalse: [ws lf; nextPutAll: sel; nextPutAll: ': '; nextPutAll: msg]].
run printString, ' ', pass printString, ws contents`;

  it('runs every vendored and Jasper test, and every one passes', (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    exec(`GsFileIn fromServerPath: ${gsStringLiteral(toLocalGemPath(testsPayload))}. 'ok'`);

    for (const [className, expected] of Object.entries(EXPECTED)) {
      const outcome = exec(runSuite(className));
      expect(outcome, `${className}\n${outcome}`).toBe(`${expected} ${expected}`);
    }
  }, 180_000);
});
