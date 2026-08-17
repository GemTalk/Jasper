/**
 * #428 item #18 — the Literals provider must not let a REAL runner failure (a GCI drop, an aborted
 * transaction) masquerade as "no results". A well-formed literal that reaches the server-side runner
 * and throws is reported through the injected error sink; the "still typing / not a literal" cases
 * stay silent (they never touch the server). In every case the provider returns [] — throwing would
 * abort sibling providers in the All scope, and the sync API has no error row.
 *
 * Kept in its own file (not providers.test.ts) so this runs clear of the parallel maxServerScan work
 * that also edits providers.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { OMNI_DEFAULTS } from '../omniConfig';
import { NEVER_CANCELLED, OmniConfig } from '../omniTypes';
import { createLiteralsProvider } from '../providers/literalsProvider';

const cfg = (over: Partial<OmniConfig> = {}): OmniConfig => ({ ...OMNI_DEFAULTS, ...over });
const boom = () => {
  throw new Error('GCI connection dropped');
};

describe('literalsProvider surfaces real runner failures via onError', () => {
  it('reports a throwing symbol runner (well-formed #symbol) and returns []', () => {
    const onError = vi.fn();
    const p = createLiteralsProvider(1, boom, vi.fn(), onError);

    const results = p.search('#at:put:', cfg(), NEVER_CANCELLED);

    expect(results).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
    const msg = String(onError.mock.calls[0][0]);
    expect(msg).toContain('#at:put:');
    expect(msg).toContain('GCI connection dropped');
  });

  it('reports a throwing string runner (well-formed string literal) and returns []', () => {
    const onError = vi.fn();
    const p = createLiteralsProvider(1, vi.fn(), boom, onError);

    const results = p.search("'oops'", cfg(), NEVER_CANCELLED);

    expect(results).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toContain('GCI connection dropped');
  });

  it('does NOT report the "still typing / not a literal" cases (they never hit the server)', () => {
    const onError = vi.fn();
    // A runner that would throw if it were ever called — proves these terms bail out before the try.
    const p = createLiteralsProvider(1, boom, boom, onError);

    for (const term of ['#', '#foo. System abortTransaction', '42', '$a', "'unterminated", '   ']) {
      expect(p.search(term, cfg(), NEVER_CANCELLED)).toEqual([]);
    }
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not throw when no error sink is wired (onError is optional)', () => {
    const p = createLiteralsProvider(1, boom, vi.fn()); // no onError

    expect(() => p.search('#at:put:', cfg(), NEVER_CANCELLED)).not.toThrow();
    expect(p.search('#at:put:', cfg(), NEVER_CANCELLED)).toEqual([]);
  });
});
