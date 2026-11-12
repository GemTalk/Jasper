// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../tonelCapability` for the full statement.
//
// The probe against a live stone. CI runs only base extents, so these check that
// the probe answers, and explains a missing capability, on a stone without Rowan 3.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../../gciLibrary';
import * as q from '../../../browserQueries';
import type { ActiveSession } from '../../../sessionManager';
import { tonelCapability, TONEL_CAPABILITIES } from '../tonelCapability';
import { testActiveSession } from '../../../__tests__/testActiveSession';

describe('tonel capability (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = (code: string): string => q.executeFetchString(session(), code);

  it('answers without raising on any stone', () => {
    // The probe is the gate itself: if it throws rather than answering, every
    // command downstream fails in a way that looks like a bug in the feature
    // instead of an absent capability. It must answer on a base
    // extent too — with everything missing.
    const result = tonelCapability(exec);
    expect(typeof result.available).toBe('boolean');
    expect(Array.isArray(result.missing)).toBe(true);
    for (const name of result.missing) expect(TONEL_CAPABILITIES).toContain(name);
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
