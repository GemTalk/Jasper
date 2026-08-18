// Integration test for the Methods-scope server fetch ceiling against a live stone, over the release
// matrix (3.6.2 and 3.7.5). Base-image reflection only — no server plugin — so it runs in both the
// bare and plugin CI passes.
//
// Regression guard for Omni Search triage #14. Two halves, both previously untested:
//   1. the generated selector scan really is BOUNDED — `searchSelectors` short-circuits the instant it
//      has `limit` matches, so a full slice genuinely means "there are more we never saw";
//   2. `methodsProvider` turns that into the truncation signal the engine needs, so the footer stops
//      presenting a cut-off slice as an exact total.
//
// The unit tests cover the clamp arithmetic with fakes; this one proves the same thing end-to-end
// against real GemStone reflection, where the short-circuit actually happens. It uses a fixture class
// with a unique selector substring and a deliberately tiny cap, so the assertions are exact numbers
// rather than "the base image probably has more than 200 of these".
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import { searchSelectors } from '../../queries/searchSelectors';
import { defaultQueryExecutorUsing } from '../../browserQueries';
import { createMethodsProvider, SERVER_OVERFETCH } from '../providers/methodsProvider';
import { OMNI_DEFAULTS } from '../omniConfig';
import { NEVER_CANCELLED, OmniConfig } from '../omniTypes';
import type { ActiveSession } from '../../sessionManager';

describe('methods fetch ceiling (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;

  const CLS = 'Issue14CeilingDemo';
  /** Unique enough that only the fixture's own methods can match — keeps the counts exact. */
  const TERM = 'iss14ceil';
  const FIXTURE_METHODS = 6;

  // A transient fixture (rolled back by the harness's abort): FIXTURE_METHODS methods whose selectors
  // all contain TERM, so a bounded scan for it has a known, small population to cut off.
  const defineFixture = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${CLS}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    for (let i = 1; i <= FIXTURE_METHODS; i++) {
      q.compileMethod(session(), CLS, false, 'accessing', `${TERM}0${i}\n\t^${i}`);
    }
  };

  const cfg = (over: Partial<OmniConfig> = {}): OmniConfig => ({ ...OMNI_DEFAULTS, ...over });

  it('stops the scan at `limit` matches, so a full slice means more exist', () => {
    defineFixture();
    const exec = defaultQueryExecutorUsing(session());

    // Asking for fewer than the fixture holds must come back exactly full — the short-circuit.
    const bounded = searchSelectors(exec, TERM, { limit: 4, ignoreCase: true });
    expect(bounded).toHaveLength(4);

    // Room to spare: the scan runs out of matches before the limit, so the slice is under-full — this
    // is what distinguishes "complete" from "cut off", and it's the whole basis of the signal.
    const complete = searchSelectors(exec, TERM, { limit: 50, ignoreCase: true });
    expect(complete).toHaveLength(FIXTURE_METHODS);
    expect(complete.every((r) => r.className === CLS && r.selector.includes(TERM))).toBe(true);
  });

  it('reports truncation through the provider when the real scan is cut off', () => {
    defineFixture();
    const runner = (term: string, limit: number, ignoreCase: boolean) =>
      searchSelectors(defaultQueryExecutorUsing(session()), term, { limit, ignoreCase });
    const provider = createMethodsProvider(1, runner);

    // Cap 1 => server slice of 1 × SERVER_OVERFETCH = 4, under the fixture's 6 rows: truncated.
    const cutOff = vi.fn();
    const shown = provider.search(
      TERM,
      cfg({ methodMinQueryLength: 3, maxResultsPerCategory: 1 }),
      NEVER_CANCELLED,
      cutOff,
    ) as unknown[];
    expect(SERVER_OVERFETCH).toBeLessThan(FIXTURE_METHODS); // the slice really is the binding limit
    // The over-fetch (1 × SERVER_OVERFETCH) bound this scan, not the configured ceiling — so the run
    // is incomplete but Load-more would still widen it, and the ceiling reported is the SETTING.
    expect(cutOff).toHaveBeenCalledWith({
      categoryId: 'methods',
      scanned: SERVER_OVERFETCH,
      ceiling: OMNI_DEFAULTS.maxServerScan,
      atCeiling: false,
    });
    expect(shown).toHaveLength(1); // and the display cap is still honored

    // Cap high enough that the clamped slice (the maxServerScan ceiling) exceeds the population.
    const complete = vi.fn();
    const all = provider.search(
      TERM,
      cfg({ methodMinQueryLength: 3, maxResultsPerCategory: 100_000 }),
      NEVER_CANCELLED,
      complete,
    ) as unknown[];
    expect(FIXTURE_METHODS).toBeLessThan(OMNI_DEFAULTS.maxServerScan);
    expect(complete).not.toHaveBeenCalled(); // no report at all = nothing was cut off
    expect(all).toHaveLength(FIXTURE_METHODS);
  });
});
