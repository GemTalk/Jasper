// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../tonelCapability` for the full statement.
//
// The probe against a live stone: does the machinery this feature drives
// actually respond on a real rowan3 image? Every other Tonel suite trusts this
// answer, so it is checked here rather than assumed everywhere.
//
// SKIPS on a base extent, including the default test stone — which is the
// correct outcome there, not a failure. See `./useRowan3Stone`.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../../gciLibrary';
import * as q from '../../../browserQueries';
import type { ActiveSession } from '../../../sessionManager';
import { tonelCapability, TONEL_CAPABILITIES } from '../tonelCapability';
import { useRowan3Stone } from './useRowan3Stone';

describe('tonel capability (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);
  // Runs as the harness's configured user (DataCurator), NOT SystemUser — that
  // is what proves the reach-through in `../rowanLookup` works for the user who
  // cannot see the Rowan dictionaries directly.
  const rowan3 = useRowan3Stone(() => exec);

  it('answers without raising on any stone', () => {
    // The probe is the gate itself: if it throws rather than answering, every
    // command and every suite downstream fails in a way that looks like a bug in
    // the feature instead of an absent capability. It must answer on a base
    // extent too — with everything missing.
    const result = tonelCapability(exec);
    expect(typeof result.available).toBe('boolean');
    expect(Array.isArray(result.missing)).toBe(true);
    for (const name of result.missing) expect(TONEL_CAPABILITIES).toContain(name);
  });

  it('reports every capability present on a rowan3 stone, as DataCurator', (ctx) => {
    rowan3.skipUnlessAvailable(ctx);
    // DataCurator's symbol list has none of the Rw* classes. Passing here means
    // the reach-through found them anyway, which is the requirement.
    expect(tonelCapability(exec)).toEqual({ available: true, missing: [] });
  });

  it('names what is absent rather than answering a bare false', () => {
    // On a base extent `missing` is the whole list; on rowan3 it is empty. The
    // invariant either way is that unavailability is always *explained*, never a
    // bare false — "Rowan is here but RwTonelParser is not" is a different
    // problem from "this is a base extent", and the user sees the same hidden
    // menu for both. Asserted as a biconditional so it holds on both stones.
    const result = tonelCapability(exec);
    expect(result.missing.length === 0).toBe(result.available);
  });
});
