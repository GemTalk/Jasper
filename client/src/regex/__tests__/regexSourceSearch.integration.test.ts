import { describe, it, expect, vi, onTestFinished } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';
import { reportedTransientLogin } from '../../__tests__/sessionGateClient';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { cancelRunOn, NbCancelledError, stoppedRunHolds } from '../../nbRunner';
import {
  RegexPatternError,
  searchMethodSourceRegex,
  searchMethodSourceRegexAsync,
} from '../../queries/regexSourceSearch';

/**
 * The regex Source search end to end: Smalltalk generated in TypeScript, run by
 * GsRegexSourceSearch in the stone, rows parsed back. Plugin pass only.
 *
 * Each test compiles a fixture class into UserGlobals inside its own transaction,
 * which the harness aborts. Its tokens (rgxIt...) occur nowhere else in the image.
 */
describe('regex source search (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest(
    (testContext) => {
      gci = testContext.gciLibrary;
      handle = testContext.session;
    },
    { sessions: 2 },
  );
  const session = (): ActiveSession => testActiveSession(gci, handle);
  function transientSession(): ActiveSession {
    const { session: transient, err } = reportedTransientLogin(session());
    if (!transient) throw new Error(`Transient login failed: ${err.message}`);
    return transient;
  }
  const exec = (code: string): string => q.executeFetchString(session(), code).trim();
  const search = (pattern: string, ignoreCase = false, limit?: number) =>
    searchMethodSourceRegex(
      (code) => q.executeFetchString(session(), code),
      pattern,
      ignoreCase,
      limit,
    );

  const FIXTURE = 'JasperRegexSearchFixture';
  const compileFixture = (run: (code: string) => string) =>
    run(`| cls lf |
lf := String with: Character lf.
cls := Object subclass: '${FIXTURE}' instVarNames: #() classVars: #() classInstVars: #()
  poolDictionaries: #() inDictionary: UserGlobals.
cls compileMethod: 'alpha', lf, '  ^#rgxItAlpha -> (Array new: 2) at: 1 put: 2; yourself'
  dictionaries: System myUserProfile symbolList category: 'fixture'.
cls compileMethod: 'beta', lf, '  ^#rgxItBeta', lf, '    at: 1', lf, '    put: 2'
  dictionaries: System myUserProfile symbolList category: 'fixture'.
cls compileMethod: 'equals', lf, '  "', ((String new: 40) atAllPut: $=; yourself), '"'
  dictionaries: System myUserProfile symbolList category: 'fixture'.
'ok'`);

  const fixtureHits = (result: { methods: Array<{ className: string; selector: string }> }) =>
    result.methods
      .filter((m) => m.className === FIXTURE)
      .map((m) => m.selector)
      .sort();

  it('finds methods by a pattern with colons, as rows like every other method search', (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    compileFixture(exec);

    const result = search('rgxIt\\w+ -> .*at: 1 put:');

    expect(fixtureHits(result)).toEqual(['alpha']);
    const row = result.methods.find((m) => m.className === FIXTURE);
    expect(row).toMatchObject({ dictName: 'UserGlobals', isMeta: false, environmentId: 0 });
    expect(result).toMatchObject({ wholeMethods: false, skipped: 0, truncated: false });
    expect(result.scanned).toBeGreaterThan(1000);
  }, 60_000);

  it('matches one line at a time, and whole methods when the pattern has \\n', (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    compileFixture(exec);

    expect(fixtureHits(search('rgxItBeta.*put:'))).toEqual([]);

    const whole = search('rgxItBeta\\n +at: 1\\n +put:');
    expect(whole.wholeMethods).toBe(true);
    expect(fixtureHits(whole)).toEqual(['beta']);
  }, 60_000);

  it('honours ignore case', (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    compileFixture(exec);

    expect(fixtureHits(search('RGXITALPHA'))).toEqual([]);
    expect(fixtureHits(search('RGXITALPHA', true))).toEqual(['alpha']);
  }, 60_000);

  it('reports a pattern it cannot use as RegexPatternError, with the reason, and leaves the session usable', (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());

    expect(() => search('a{3}')).toThrow(RegexPatternError);
    expect(() => search('a{3}')).toThrow(/counted repetition/);
    expect(() => search('(?:a)')).toThrow(/not supported/);
    expect(() => search('a(')).toThrow(RegexPatternError);
    expect(exec('(3 + 4) printString')).toBe('7');
  });

  it('caps the rows and says so when more methods match', (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());

    const result = search('[a-z]+:');

    expect(result.truncated).toBe(true);
    expect(result.methods.length).toBe(500);
  }, 120_000);

  it('returns every method up to a limit the caller sets above 500, not only the first 500', (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());

    const result = search('[a-z]+:', false, 750);

    expect(result.truncated).toBe(true);
    expect(result.methods.length).toBe(750);
    expect(result.methods.every((m) => (m.matches?.length ?? 0) > 0)).toBe(true);
  }, 120_000);

  it('a soft break stops a search that would run for minutes, and the session is usable after', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    // On its own session: the run must be stopped while the main session stays free.
    const transient = transientSession();
    onTestFinished(() => {
      transient.logout();
    });
    const run = (code: string) => q.executeFetchString(transient, code).trim();
    compileFixture(run);

    // (=+)+x against 40 '=' and no x: about 2^40 ways to fail. Nothing to pre-filter on,
    // so the matcher runs on every line until it reaches the fixture and stalls there.
    const query = searchMethodSourceRegexAsync(
      (code) => q.executeFetchStringAsync(transient, code),
      '(=+)+x',
      false,
    );
    query.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await vi.waitFor(() => expect(cancelRunOn(transient)).toBe(true));

    await expect(query).rejects.toBeInstanceOf(NbCancelledError);
    await vi.waitFor(() => expect(stoppedRunHolds(transient)).toBe(false), { timeout: 15_000 });
    expect(run('(3 + 4) printString')).toBe('7');
  }, 90_000);
});
