// Integration test for the RELEVANCE of the Methods-scope selector scan against a live stone, over the
// release matrix (3.6.2 and 3.7.5). Base-image reflection only — no server plugin, no fixture — so it
// runs in both the bare and plugin CI passes.
//
// Regression guard for issue #517: typing `at:` returned no `Array>>at:` anywhere in the results. The
// old scan collected the first `limit` selectors CONTAINING the term, walking the symbol list in
// dictionary-hash order, and a term as common as `at:` filled that slice with `instVarAt:put:` /
// `floatAt:put:` from whichever couple of classes the walk happened to reach first. Measured on a
// 3.6.2 base image: 1142 selectors contain `at:` and only 31 ARE `at:`, so the exact implementors —
// the rows anybody typing `at:` wants — sat far past a cutoff of 80 and never reached the client.
//
// The fix ranks on the SERVER (exact selector, then prefix, then substring elsewhere), so the cut-off
// falls on the least relevant tail. That cannot be tested with fakes: it only shows up against an
// image big enough for the scan to give up, walked in an order nobody controls. Hence a live stone,
// asserting on `Array>>at:` — which every GemStone image has, on a class whose name sorts early enough
// that the tie-break puts it on the first page.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import { searchSelectors } from '../../queries/searchSelectors';
import { defaultQueryExecutorUsing } from '../../browserQueries';
import { createMethodsProvider, SERVER_OVERFETCH } from '../providers/methodsProvider';
import { OMNI_DEFAULTS } from '../omniConfig';
import { NEVER_CANCELLED, OmniConfig, OmniResult } from '../omniTypes';
import type { ActiveSession } from '../../sessionManager';

describe('methods search relevance (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const cfg = (over: Partial<OmniConfig> = {}): OmniConfig => ({ ...OMNI_DEFAULTS, ...over });

  it('returns the exact implementors of a common selector even though the scan is bounded', () => {
    const exec = defaultQueryExecutorUsing(session());
    const limit = OMNI_DEFAULTS.maxResultsPerCategory * SERVER_OVERFETCH;

    const rows = searchSelectors(exec, 'at:', { limit, ignoreCase: true });

    // The scan really is up against its bound — this is the condition under which the bug appeared.
    expect(rows).toHaveLength(limit);
    // Yet the exact implementors are what came back, `Array>>at:` among them.
    expect(rows.some((r) => r.className === 'Array' && r.selector === 'at:')).toBe(true);
    // And they lead: everything before the first non-exact row is an `at:` implementor.
    const firstInexact = rows.findIndex((r) => r.selector !== 'at:');
    expect(firstInexact).toBeGreaterThan(1);
    expect(rows.slice(0, firstInexact).every((r) => r.selector === 'at:')).toBe(true);
  });

  it('puts Array>>at: on the first page of the Methods results for the term `at:`', () => {
    const provider = createMethodsProvider(1, (term, limit, ignoreCase) =>
      searchSelectors(defaultQueryExecutorUsing(session()), term, { limit, ignoreCase }),
    );

    const shown = provider.search('at:', cfg(), NEVER_CANCELLED) as OmniResult[];
    const labels = shown.map((r) => r.label);

    // The reported bug, in one assertion.
    expect(labels).toContain('Array>>at:');
    // The rows are ranked, so the exact hits fill the top of the page, not just appear somewhere in it.
    expect(labels.indexOf('Array>>at:')).toBeLessThan(10);
    expect(labels[0].endsWith('>>at:')).toBe(true);
  });

  it('still finds a selector the term only appears INSIDE, once the better tiers run out', () => {
    // The tiers must not become a filter: a term with no exact and no prefix match has to fall through
    // to plain substring hits, which is the only thing the old scan did.
    const rows = searchSelectors(defaultQueryExecutorUsing(session()), 'VarAt:pu', {
      limit: 40,
      ignoreCase: true,
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.selector.toLowerCase().includes('varat:pu'))).toBe(true);
    expect(rows.some((r) => r.selector === 'instVarAt:put:')).toBe(true);
  });
});
