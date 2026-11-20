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
import { probeRegexSupport } from '../../browserQueries';
import { refreshRegexSupportAvailable } from '../regexAvailability';
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

  /** Compile one more method into the fixture class; `sourceExpr` is a Smalltalk expression
   *  answering its source, with `lf`, `cr` and `crlf` bound. */
  const compileExtra = (sourceExpr: string, run: (code: string) => string = exec) =>
    run(`| lf cr crlf |
lf := String with: Character lf.
cr := String with: Character cr.
crlf := cr, lf.
${FIXTURE} compileMethod: ${sourceExpr}
  dictionaries: System myUserProfile symbolList category: 'fixture'.
'ok'`);

  /** The text each of a hit's matches covers, cut from the method's source on the stone. */
  const matchedText = (
    result: {
      methods: Array<{
        className: string;
        selector: string;
        matches?: Array<{ start: number; end: number }>;
      }>;
    },
    selector: string,
  ) => {
    const row = result.methods.find((m) => m.className === FIXTURE && m.selector === selector);
    if (!row) throw new Error(`${selector} was not found`);
    const source = q.executeFetchString(
      session(),
      `(${FIXTURE} compiledMethodAt: #${selector}) sourceString`,
    );
    return (row.matches ?? []).map((m) => source.slice(m.start, m.end));
  };

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

  // The 3.6.x compiler fails on non-ASCII source, so a pattern such as café must not reach it as
  // text. The alternation proves the pattern ran: the fixture is found through its other branch.
  it('runs a pattern with non-ASCII characters, and the session stays usable', (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    compileFixture(exec);

    expect(fixtureHits(search('café😀|rgxItAlpha'))).toEqual(['alpha']);
    expect(fixtureHits(search('é'))).toEqual([]);
    expect(exec('(3 + 4) printString')).toBe('7');
  }, 60_000);

  it('counts a method too long to match as a whole as skipped, not failed', (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    compileFixture(exec);
    compileExtra(
      `'long', lf, '  "rgxItLongStart ', ((String new: 5000) atAllPut: $x; yourself), lf, ' rgxItLongEnd"'`,
    );

    const result = search('rgxItLongStart.*\\n.*rgxItLongEnd');

    expect(result).toMatchObject({ wholeMethods: true, failed: 0 });
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(fixtureHits(result)).toEqual([]);
  }, 60_000);

  it('gives the exact text of each match, on a line after the first', (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    compileFixture(exec);

    expect(matchedText(search('at: \\d+'), 'beta')).toEqual(['at: 1']);
    expect(matchedText(search('rgxItBeta\\n +at'), 'beta')).toEqual(['rgxItBeta\n    at']);
  }, 60_000);

  // The fast pre-filter must read a set as the library does: every [ inside needs its own ].
  it('finds a method through a set that contains [', (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    compileFixture(exec);
    compileExtra(`'nested', lf, '  ^#rgxItNested_ax'`);

    expect(fixtureHits(search('rgxItNested_[[]abcdefghij]x'))).toEqual(['nested']);
  }, 60_000);

  it('refuses lazy quantifiers and back-references, naming them', (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());

    expect(() => search('a.*?b')).toThrow(/lazy and possessive quantifiers/);
    expect(() => search('(a)\\1')).toThrow(/no back-references/);
    expect(() => search('\\x41')).toThrow(/\\x is not supported/);
    expect(exec('(3 + 4) printString')).toBe('7');
  });

  // What a user brings from JavaScript or PCRE: each works, or is refused with the reason.
  it('answers the common constructs from other dialects plainly', (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    compileFixture(exec);

    expect(fixtureHits(search('\\brgxItAlpha\\b'))).toEqual(['alpha']);
    expect(fixtureHits(search('at: \\d put: \\d'))).toEqual(['alpha']);
    expect(fixtureHits(search('rgxIt(Alpha|Beta)$'))).toEqual(['beta']);
    expect(() => search('a{2,3}')).toThrow(/counted repetition/);
    expect(() => search('(?=a)')).toThrow(/not supported/);
  }, 60_000);

  it('finds a pattern with a quote and one with a backslash', (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    compileFixture(exec);
    compileExtra(`'quoted', lf, '  ^''rgxItQuote''', lf, '  , ''rgxItSlash\\x'''`);

    expect(fixtureHits(search("'rgxItQuote'"))).toEqual(['quoted']);
    expect(matchedText(search('rgxItSlash\\\\x'), 'quoted')).toEqual(['rgxItSlash\\x']);
  }, 60_000);

  it('splits methods saved with CRLF or CR alone into lines, and the matches line up', (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    compileFixture(exec);
    compileExtra(`'crlf', crlf, '  ^#rgxItCrlfOne', crlf, '  -> #rgxItCrlfTwo'`);
    compileExtra(`'crOnly', cr, '  ^#rgxItCrOne', cr, '  -> #rgxItCrTwo'`);

    expect(matchedText(search('^ *-> #rgxItCrlf\\w+$'), 'crlf')).toEqual(['  -> #rgxItCrlfTwo']);
    expect(matchedText(search('^ *-> #rgxItCr\\w+$'), 'crOnly')).toEqual(['  -> #rgxItCrTwo']);
  }, 60_000);

  // A login, or a search, keeps the session busy for a while; a probe then must not decide the
  // support is missing and grey out .*.
  it('keeps regex support available when the check finds the session busy', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    const transient = transientSession();
    onTestFinished(() => {
      transient.logout();
    });
    compileFixture((code) => q.executeFetchString(transient, code).trim());
    transient.regexSupportAvailable = true;
    const query = searchMethodSourceRegexAsync(
      (code) => q.executeFetchStringAsync(transient, code),
      '(=+)+x',
      false,
    );
    query.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(probeRegexSupport(transient)).toBeUndefined();
    expect(refreshRegexSupportAvailable(transient)).toBe(true);
    expect(transient.regexSupportAvailable).toBe(true);

    await vi.waitFor(() => expect(cancelRunOn(transient)).toBe(true));
    await query.catch(() => undefined);
    await vi.waitFor(() => expect(stoppedRunHolds(transient)).toBe(false), { timeout: 15_000 });
    expect(refreshRegexSupportAvailable(transient)).toBe(true);
  }, 90_000);

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
