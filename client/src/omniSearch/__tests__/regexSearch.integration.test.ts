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
import { stoppedRunHolds } from '../../nbRunner';
import { createOmniEngine } from '../omniEngine';
import { OMNI_DEFAULTS } from '../omniConfig';
import { regexSearchUsing } from '../omniSearchCommand';

/**
 * GemStone Search's regex search end to end: the panel's engine with the real runner, against the
 * server plugin's regex support on a live stone. Plugin pass only.
 *
 * Each test works on its own transient session, with a fixture class compiled there and never
 * committed, so a stopped search cannot leave the harness's session busy.
 */
describe('GemStone Search regex search (integration)', () => {
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

  const FIXTURE = 'JasperRegexPanelFixture';

  function fixtureSession(): ActiveSession {
    const { session: transient, err } = reportedTransientLogin(session());
    if (!transient) throw new Error(`Transient login failed: ${err.message}`);
    onTestFinished(() => {
      transient.logout();
    });
    q.executeFetchString(
      transient,
      `| cls lf |
lf := String with: Character lf.
cls := Object subclass: '${FIXTURE}' instVarNames: #() classVars: #() classInstVars: #()
  poolDictionaries: #() inDictionary: UserGlobals.
cls compileMethod: 'alpha', lf, '  ^#rgxPanelAlpha at: 1 put: 2'
  dictionaries: System myUserProfile symbolList category: 'fixture'.
cls compileMethod: 'equals', lf, '  "', ((String new: 40) atAllPut: $=; yourself), '"'
  dictionaries: System myUserProfile symbolList category: 'fixture'.
cls compileMethod: 'beta', lf, '  ^#rgxPanelBeta', lf, '    at: 1', lf, '    put: #rgxPanelBeta'
  dictionaries: System myUserProfile symbolList category: 'fixture'.
'ok'`,
    );
    return transient;
  }

  const engineOn = (s: ActiveSession) =>
    createOmniEngine({
      providers: [],
      config: OMNI_DEFAULTS,
      regexSearch: regexSearchUsing(s),
      regexAvailable: () => true,
    });

  it('finds a method on Enter, and only on Enter', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    const engine = engineOn(fixtureSession());
    await engine.toggleRegex();

    const typed = await engine.search('rgxPanel\\w+ at: 1 put:');
    expect(typed?.regexPending).toBe(true);
    expect(typed?.rows).toEqual([]);

    const view = await engine.submit('rgxPanel\\w+ at: 1 put:');

    expect(view?.notice).toBeUndefined();
    expect(view?.rows.map((r) => [r.label, r.categoryId])).toContainEqual([
      `${FIXTURE}>>alpha`,
      'source',
    ]);
  }, 60_000);

  it('searches again on the stone when Aa is clicked over an answer', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    const engine = engineOn(fixtureSession());
    await engine.toggleRegex();
    const label = `${FIXTURE}>>alpha`;

    const ignoringCase = await engine.submit('RGXPANELALPHA');
    const exactCase = await engine.toggleCase();

    expect(ignoringCase?.rows.map((r) => r.label)).toContain(label);
    expect(exactCase?.regexPending).toBeUndefined();
    expect(exactCase?.rows.map((r) => r.label)).not.toContain(label);
    expect(exactCase?.notice).toBe('No methods match.');
  }, 60_000);

  it("shows the stone's reason for a pattern it cannot use", async (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    const engine = engineOn(fixtureSession());
    await engine.toggleRegex();

    const view = await engine.submit('a{3}');

    expect(view).toMatchObject({ rows: [], noticeIsError: true });
    expect(view?.notice).toContain('counted repetition');
  }, 60_000);

  it('a new search stops a runaway one on the stone, and answers', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    const transient = fixtureSession();
    const engine = engineOn(transient);
    await engine.toggleRegex();

    // (=+)+x against 40 '=' and no x: about 2^40 steps, with no plain text to pre-filter on.
    const runaway = engine.submit('(=+)+x');
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const next = engine.submit('rgxPanelAlpha');

    expect(await runaway).toBeNull();
    await vi.waitFor(() => expect(stoppedRunHolds(transient)).toBe(false), { timeout: 20_000 });
    const view = await next;
    expect(view?.notice).toBeUndefined();
    expect(view?.rows.map((r) => r.label)).toContain(`${FIXTURE}>>alpha`);
  }, 90_000);

  it('turning regex off stops a runaway search, leaving the session usable', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    const transient = fixtureSession();
    const engine = engineOn(transient);
    await engine.toggleRegex();

    const runaway = engine.submit('(=+)+x');
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await engine.toggleRegex();

    // Turning .* off returns only once the stone has let go, so the plain search it runs is not
    // refused as busy.
    expect(stoppedRunHolds(transient)).toBe(false);
    expect(await runaway).toBeNull();
    expect(q.executeFetchString(transient, '(3 + 4) printString').trim()).toBe('7');
  }, 90_000);

  it('gives each hit the place of every match in its source, a match across lines included', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.regex, ctx, session());
    const s = fixtureSession();
    const engine = engineOn(s);
    await engine.toggleRegex();

    // Whole-method mode (the pattern has \\n): the first branch matches across the line break, the
    // second the token alone at the end.
    const view = await engine.submit('rgxPanelBeta\\n +at: 1|rgxPanelBeta');

    const row = view?.rows.find((r) => r.label === `${FIXTURE}>>beta`);
    const action = row && engine.resultFor(row.id)?.action;
    if (action?.kind !== 'openMethod')
      throw new Error('expected the fixture method among the hits');
    const source = q.executeFetchString(s, `(${FIXTURE} compiledMethodAt: #beta) sourceString`);
    expect(action.matches?.map((m) => source.slice(m.start, m.end))).toEqual([
      'rgxPanelBeta\n    at: 1',
      'rgxPanelBeta',
    ]);
  }, 60_000);
});
